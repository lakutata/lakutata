import Keyv from 'keyv'
import {MysqlCacheOptions} from '../options/MysqlCacheOptions.js'
import {IsDriverPackageInstalled} from '../lib/IsDriverPackageInstalled.js'

export async function CreateMysqlCacheAdapter(storeOptions: MysqlCacheOptions): Promise<Keyv> {
    IsDriverPackageInstalled('mysql2')
    const KeyvMysql = (await import('@keyv/mysql')).KeyvMysql
    return new Keyv({
        store: new KeyvMysql({
            host: storeOptions.host,
            port: storeOptions.port,
            user: storeOptions.username,
            password: storeOptions.password,
            database: storeOptions.database,
            table: storeOptions.table
        }), namespace: storeOptions.namespace
    })
}