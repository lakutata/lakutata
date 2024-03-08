import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_ID} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {ConstructorSymbol} from './ConstructorSymbol.js'
import {As} from '../functions/As.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'

/**
 * Set configurable records to target constructor with its registration name
 * @param target
 * @param registrationName
 * @param configurableRecords
 * @constructor
 */
export function SetConfigurableRecords<ClassConstructor extends typeof BaseObject>(target: ClassConstructor, registrationName: string | symbol, configurableRecords: Record<string, any>): void {
    if (Reflect.hasOwnMetadata(registrationName, target)) Reflect.deleteMetadata(registrationName, target)
    Reflect.defineMetadata(registrationName, configurableRecords, target)
}

/**
 * Get configurable records from target constructor by its registration name
 * @param target
 * @constructor
 */
export function GetConfigurableRecords<ClassConstructor extends typeof BaseObject>(target: ClassConstructor, registrationName: string | symbol): Record<string, any> {
    const configurableRecords: Record<string, any> = Reflect.getOwnMetadata(registrationName, target)
    if (configurableRecords) return configurableRecords
    return {}
}

/**
 * Set id to instance
 * @param target
 * @param id
 * @constructor
 */
export function SetIdToInstance<ClassInstance extends BaseObject>(target: ClassInstance, id: string | symbol): void {
    Reflect.defineMetadata(DI_TARGET_ID, id, target)
}

/**
 * Get id from instance
 * @param target
 * @constructor
 */
export function GetIdFromInstance<ClassInstance extends BaseObject>(target: ClassInstance): string | symbol | undefined {
    const id: string | symbol | undefined = Reflect.getOwnMetadata(DI_TARGET_ID, target)
    if (typeof id === 'string') return id
    if (ConstructorSymbol(As<IBaseObjectConstructor>(target.constructor)) !== id) return id
    return undefined
}

/**
 * Set configurable records to instance's metadata
 * @param target
 * @param configurableRecords
 * @constructor
 */
export function SetConfigurableRecordsToInstance<ClassInstance extends BaseObject>(target: ClassInstance, configurableRecords: Record<string, any>): void {
    Reflect.defineMetadata(target.$uuid, configurableRecords, target)
}

/**
 * Get configurable records from instance's metadata
 * @param target
 * @constructor
 */
export function GetConfigurableRecordsFromInstance<ClassInstance extends BaseObject>(target: ClassInstance): Record<string, any> {
    const configurableRecords: Record<string, any> = Reflect.getOwnMetadata(target.$uuid, target)
    if (configurableRecords) return configurableRecords
    return {}
}
