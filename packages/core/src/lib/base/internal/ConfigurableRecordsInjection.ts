import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_ID} from '../../../constants/DIMetadataKey.js'
import {constructorSymbol} from '../../ioc/ConstructorSymbol.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {type Resolver} from '../../ioc/Resolvers.js'
import {As} from '@lakutata/utils/As'

//The configurable records of the registrations, by resolver: each container keeps the options of its own registrations
const registrationRecords: WeakMap<Resolver<any>, Record<string, any>> = new WeakMap()

/**
 * Set configurable records to a registration (the options it was declared with)
 * @param registration
 * @param configurableRecords
 * @constructor
 */
export function setConfigurableRecords(registration: Resolver<any>, configurableRecords: Record<string, any>): void {
    registrationRecords.set(registration, configurableRecords)
}

/**
 * Get configurable records from a registration
 * @param registration
 * @constructor
 */
export function getConfigurableRecords(registration: Resolver<any> | null): Record<string, any> {
    return (registration && registrationRecords.get(registration)) ?? {}
}

/**
 * Set id to instance
 * @param target
 * @param id
 * @constructor
 */
export function setIdToInstance<ClassInstance extends BaseObject>(target: ClassInstance, id: string | symbol): void {
    Reflect.defineMetadata(DI_TARGET_ID, id, target)
}

/**
 * Get id from instance
 * @param target
 * @constructor
 */
export function getIdFromInstance<ClassInstance extends BaseObject>(target: ClassInstance): string | symbol | undefined {
    const id: string | symbol | undefined = Reflect.getOwnMetadata(DI_TARGET_ID, target)
    if (typeof id === 'string') return id
    if (constructorSymbol(As<IBaseObjectConstructor>(target.constructor)) !== id) return id
    return undefined
}

/**
 * Get the registration name the instance was resolved by (including constructor symbols, unlike GetIdFromInstance)
 * @param target
 * @constructor
 */
export function getRegistrationNameFromInstance<ClassInstance extends BaseObject>(target: ClassInstance): string | symbol | undefined {
    return Reflect.getOwnMetadata(DI_TARGET_ID, target)
}

/**
 * Set configurable records to instance's metadata
 * @param target
 * @param configurableRecords
 * @constructor
 */
export function setConfigurableRecordsToInstance<ClassInstance extends BaseObject>(target: ClassInstance, configurableRecords: Record<string, any>): void {
    Reflect.defineMetadata(target.$uuid, configurableRecords, target)
}

/**
 * Get configurable records from instance's metadata
 * @param target
 * @constructor
 */
export function getConfigurableRecordsFromInstance<ClassInstance extends BaseObject>(target: ClassInstance): Record<string, any> {
    const configurableRecords: Record<string, any> = Reflect.getOwnMetadata(target.$uuid, target)
    if (configurableRecords) return configurableRecords
    return {}
}
