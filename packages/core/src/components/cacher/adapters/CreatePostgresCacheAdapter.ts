import Keyv from 'keyv'
import {PostgresCacheOptions} from '../options/PostgresCacheOptions.js'
import {URLBuilder} from '../../../lib/helpers/URLBuilder.js'
import {IsDriverPackageInstalled} from '../lib/IsDriverPackageInstalled.js'

export async function CreatePostgresCacheAdapter(storeOptions: PostgresCacheOptions): Promise<Keyv> {
    IsDriverPackageInstalled('pg')
    const KeyvPostgres = (await import('@keyv/postgres')).KeyvPostgres
    const postgresURLBuilder: URLBuilder = new URLBuilder()
    postgresURLBuilder.protocol = 'postgresql'
    postgresURLBuilder.host = storeOptions.host
    postgresURLBuilder.port = storeOptions.port
    postgresURLBuilder.username = storeOptions.username
    postgresURLBuilder.password = storeOptions.password
    postgresURLBuilder.pathname = storeOptions.database
    return new Keyv({
        store: new KeyvPostgres({
            uri: postgresURLBuilder.toString(),
            table: storeOptions.table,
            schema: storeOptions.schema,
            max: storeOptions.maxPoolSize
        }), namespace: storeOptions.namespace
    })
}