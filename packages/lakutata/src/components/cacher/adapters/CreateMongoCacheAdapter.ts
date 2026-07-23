import Keyv from 'keyv'
import {MongoCacheOptions} from '../options/MongoCacheOptions.js'
import {URLBuilder} from '../../../lib/helpers/URLBuilder.js'
import {IsDriverPackageInstalled} from '../lib/IsDriverPackageInstalled.js'

export async function CreateMongoCacheAdapter(storeOptions: MongoCacheOptions): Promise<Keyv> {
    IsDriverPackageInstalled('mongodb')
    const KeyvMongo = (await import('@keyv/mongo')).KeyvMongo
    const mongoURLBuilder: URLBuilder = new URLBuilder()
    mongoURLBuilder.protocol = 'mongodb'
    mongoURLBuilder.host = storeOptions.host
    mongoURLBuilder.port = storeOptions.port
    mongoURLBuilder.username = storeOptions.username
    mongoURLBuilder.password = storeOptions.password
    return new Keyv({
        store: new KeyvMongo(mongoURLBuilder.toString(), {
            db: storeOptions.database,
            namespace: storeOptions.namespace,
            collection: storeOptions.collection
        }), namespace: storeOptions.namespace
    })
}