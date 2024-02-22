import {BaseObject} from '../BaseObject.js'
import {IConstructor} from '../../../interfaces/IConstructor.js'
import {
    DI_TARGET_CONSTRUCTOR_UUID
} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {createHash, randomUUID} from 'node:crypto'
import {stringify} from 'querystring'

/**
 * Generate constructor hash string
 * @param constructor
 * @constructor
 */
export function ConstructorHash<T extends BaseObject>(constructor: IConstructor<T>): string {
    if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_UUID, constructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_UUID, randomUUID(), constructor)
    return createHash('md5').update(Buffer.from(stringify({
        name: constructor.name,
        hash: createHash('md5').update(Buffer.from(constructor.toString())).digest().toString('hex'),
        uuid: Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_UUID, constructor)
    }))).digest().toString('hex')
}