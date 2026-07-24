import Keyv from 'keyv'
import {SqliteCacheOptions} from '../options/SqliteCacheOptions.js'
import {URLBuilder} from '../../../lib/helpers/URLBuilder.js'
import {IsDriverPackageInstalled} from '../lib/IsDriverPackageInstalled.js'

export async function CreateSqliteCacheAdapter(storeOptions: SqliteCacheOptions): Promise<Keyv> {
    IsDriverPackageInstalled('sqlite3')
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