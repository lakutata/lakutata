import Keyv from 'keyv'
import {RedisCacheOptions} from '../options/RedisCacheOptions.js'

export async function CreateRedisCacheAdapter(storeOptions: RedisCacheOptions): Promise<Keyv> {
    try {
        require.resolve('redis')
    } catch (e) {
        throw new Error('Node-Redis package is required for this driver. Run "npm install redis".')
    }
    const KeyvRedis = (await import('@keyv/redis')).default
    return new Keyv({
        store: new KeyvRedis({
            username: storeOptions.username,
            password: storeOptions.password,
            database: storeOptions.database,
            socket: {
                host: storeOptions.host,
                port: storeOptions.port,
                tls: storeOptions.tls,
                keepAlive: storeOptions.keepAlive,
                reconnectStrategy: storeOptions.reconnect ? 10 : false
            }
        }, {
            namespace: storeOptions.namespace,
            keyPrefixSeparator: storeOptions.keyPrefixSeparator,
            clearBatchSize: storeOptions.clearBatchSize,
            useUnlink: storeOptions.useUnlink,
            noNamespaceAffectsAll: storeOptions.noNamespaceAffectsAll,
            connectionTimeout: storeOptions.connectTimeout,
            throwOnConnectError: storeOptions.throwOnConnectError
        }), namespace: storeOptions.namespace
    })
}