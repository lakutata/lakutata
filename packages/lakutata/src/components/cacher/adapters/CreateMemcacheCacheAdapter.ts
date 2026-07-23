import {MemcacheCacheOptions} from '../options/MemcacheCacheOptions.js'
import Keyv from 'keyv'
import {URLBuilder} from '../../../lib/helpers/URLBuilder.js'
import {IsDriverPackageInstalled} from '../lib/IsDriverPackageInstalled.js'

export async function CreateMemcacheCacheAdapter(storeOptions: MemcacheCacheOptions): Promise<Keyv> {
    IsDriverPackageInstalled('memjs')
    const KeyvMemcache = (await import('@keyv/memcache')).KeyvMemcache
    const memcacheURLBuilder: URLBuilder = new URLBuilder()
    memcacheURLBuilder.host = storeOptions.host
    memcacheURLBuilder.port = storeOptions.port
    memcacheURLBuilder.username = storeOptions.username
    memcacheURLBuilder.password = storeOptions.password
    return new Keyv({
        store: new KeyvMemcache(memcacheURLBuilder.toString()),
        namespace: storeOptions.namespace
    })
}