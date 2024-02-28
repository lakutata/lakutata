import {BaseObject} from '../BaseObject.js'

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
