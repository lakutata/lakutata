import Keyv from 'keyv'
import {SqliteCacheOptions} from '../options/SqliteCacheOptions.js'
import {URLBuilder} from '../../../lib/helpers/URLBuilder.js'

export async function CreateSqliteCacheAdapter(storeOptions: SqliteCacheOptions): Promise<Keyv> {
    try {
        require.resolve('sqlite3')
    } catch (e) {
        throw new Error('SQLite3 package is required for this driver. Run "npm install sqlite3".')
    }
    const KeyvSqlite = (await import('@keyv/sqlite')).KeyvSqlite
    const sqliteURLBuilder: URLBuilder = new URLBuilder()
    sqliteURLBuilder.protocol = 'sqlite'
    sqliteURLBuilder.pathname = storeOptions.database
    return new Keyv({
        store: new KeyvSqlite({
            uri: sqliteURLBuilder.toString(),
            table: storeOptions.table,
            busyTimeout: storeOptions.busyTimeout
        }), namespace: storeOptions.namespace
    })
}