import { DatabaseType } from "@/common/constants";
import { Global } from "@/common/global";
import { Node } from "@/model/interface/node";
import { TableNode } from "@/model/main/tableNode";
import { ColumnNode } from "@/model/other/columnNode";
import { DbTreeDataProvider } from "@/provider/treeDataProvider";
import { ViewManager } from "@/view/viewManager";
import { DatabaseCache } from "../common/databaseCache";
import { ConnectionManager } from "../connectionManager";
import { QueryUnit } from "../queryUnit";

export class DiffService {
    startDiff(provider: DbTreeDataProvider) {

        ViewManager.createWebviewPanel({
            path: "app", title: "Struct Sync",
            splitView: false, iconPath: Global.getExtPath("resources", "icon", "add.svg"),
            eventHandler: (handler => {
                handler.on("init", () => {
                    handler.emit('route', 'structDiff')
                }).on("route-structDiff", async () => {
                    const nodes = (await provider.getConnectionNodes())
                    let databaseList = {}
                    for (const node of nodes) {
                        databaseList[node.label] = await node.getChildren()
                    }
                    handler.emit('structDiff-data', { nodes, databaseList })
                }).on("execute", async sql => {
                    try {
                        // await this.execute(sql)
                        handler.emit("success")
                    } catch (error) {
                        handler.emit("error", error.message)
                    }
                }).on("start", async (opt) => {
                    const fromTables = DatabaseCache.getChildListOfId(`${opt.from.connection}_${opt.from.database}#TABLE`)
                    const toTables = DatabaseCache.getChildListOfId(`${opt.to.connection}_${opt.to.database}#TABLE`)

                    let sqlList = await this.compareTables(fromTables, toTables);
                    handler.emit("compareResult", { sqlList })
                }).on("sync", async ({ option, sqlList }) => {

                    const databaseId = `${option.from.connection}_${option.from.database}`
                    const dbNode = Node.nodeCache[databaseId]
                    try {
                        await QueryUnit.runBatch(await ConnectionManager.getConnection(dbNode), sqlList.map(sql => sql.sql))
                        handler.emit("syncSuccess")
                    } catch (error) {
                        handler.emit("error", error.message)
                    }
                })
            })
        })


    }


    private async compareTables(fromTables: Node[], toTables: Node[]) {
        let toTablesMap = {}
        let sqlList: any[] = [];
        for (const table of toTables) {
            toTablesMap[table.label] = table;
        }

        for (const table of fromTables) {
            if (toTablesMap[table.label]) {
                const fromChilds = await table.getChildren()
                const toChilds = await (toTablesMap[table.label] as TableNode).getChildren()
                sqlList.push(...await this.comapreChilds(fromChilds, toChilds))
                delete toTablesMap[table.label];
            } else {
                sqlList.push({ type: 'remove', sql: `Drop table ${table.label}` });
            }
        }

        for (const newTable in toTablesMap) {
            const newTableNode = toTablesMap[newTable] as TableNode;
            sqlList.push({ type: 'add', sql: await newTableNode.showSource(false) });
        }
        return sqlList;
    }

    private async comapreChilds(fromColumns: Node[], toTables: Node[]) {
        let toColumnsMap = {}
        let sqlList = [];
        for (const table of toTables) {
            toColumnsMap[table.label] = table;
        }

        fromColumns.forEach((fromColumn: ColumnNode) => {
            if (toColumnsMap[fromColumn.label]) {
                const toColumnNode = toColumnsMap[fromColumn.label] as ColumnNode
                if (toColumnNode.type != fromColumn.type) {
                    if(toColumnNode.dbType==DatabaseType.MSSQL || toColumnNode.dbType==DatabaseType.PG){
                        sqlList.push({ type: 'change', sql: `ALTER TABLE ${toColumnNode.table} ALTER COLUMN ${toColumnNode.label} ${toColumnNode.type}` });
                    }else{
                        sqlList.push({ type: 'change', sql: `ALTER TABLE ${toColumnNode.table} CHANGE ${toColumnNode.label} ${toColumnNode.label} ${toColumnNode.type} ;` });
                    }
                }
                delete toColumnsMap[fromColumn.label];
            } else {
                sqlList.push({ type: 'remove', sql: `ALTER TABLE ${fromColumn.wrap(fromColumn.table)} DROP COLUMN ${fromColumn.wrap(fromColumn.label)};` });
            }
        })

        for (const toColumn in toColumnsMap) {
            const newColumnNode = toColumnsMap[toColumn] as ColumnNode;
            if (newColumnNode.dbType == DatabaseType.MSSQL) {
                sqlList.push({ type: 'add', sql: `ALTER TABLE ${newColumnNode.table} ADD ${newColumnNode.label} ${newColumnNode.column.type};` });
            } else {
                sqlList.push({ type: 'add', sql: `ALTER TABLE ${newColumnNode.table} ADD COLUMN ${newColumnNode.label} ${newColumnNode.column.type};` });

            }
        }
        return sqlList;
    }

}