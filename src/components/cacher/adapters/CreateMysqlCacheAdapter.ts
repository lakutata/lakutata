import Keyv from 'keyv'
import {MysqlCacheOptions} from '../options/MysqlCacheOptions.js'

export async function CreateMysqlCacheAdapter(storeOptions: MysqlCacheOptions): Promise<Keyv> {
    try {
        require.resolve('mysql2')
    } catch (e) {
        throw new Error('MySQL2 package is required for this driver. Run "npm install mysql2".')
    }
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