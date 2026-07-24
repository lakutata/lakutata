import Keyv from 'keyv'
import {KeyvFile} from 'keyv-file'
import {FileCacheOptions} from '../options/FileCacheOptions.js'

export async function CreateFileCacheAdapter(storeOptions: FileCacheOptions): Promise<Keyv> {
    return new Keyv({
        store: new KeyvFile({
            filename: storeOptions.filename,
            expiredCheckDelay: storeOptions.expiredCheckDelay,
            writeDelay: storeOptions.writeDelay
        }),
        namespace: storeOptions.namespace
    })
}