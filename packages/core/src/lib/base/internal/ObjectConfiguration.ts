import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES} from '../../../constants/DIMetadataKey.js'
import {DTO} from '../../dto/DTO.js'
import {Schema} from '../../validation/types/Schema.js'
import {objectConstructor} from '@lakutata/utils/ObjectConstructor'
import {mergedDeclarations, ownDeclarations, REMOVED} from './MemberDeclarations.js'

export type ObjectConfigurablePropertyMap<DataType = any> = Map<string | symbol, {
    schema: Schema<DataType>
    fn: (value: DataType) => DataType | Promise<DataType>
}>

/**
 * Add object configurable property to Set
 * @param target
 * @param propertyKey
 * @param schema
 * @param fn
 * @constructor
 */
export function setObjectConfigurableProperty<ClassPrototype extends BaseObject, DataType>(target: ClassPrototype, propertyKey: string | symbol, schema: Schema<DataType> = DTO.Any(), fn?: (value: DataType) => DataType | Promise<DataType>): void {
    ownDeclarations(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, objectConstructor(target)).set(propertyKey, {
        schema: schema,
        fn: fn ? fn : (value: DataType) => value
    })
}

/**
 * Remove the configurable property of the parents of a class: the class declares the property otherwise
 * @param target
 * @param propertyKey
 * @constructor
 */
export function removeObjectConfigurableProperty<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    ownDeclarations(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, objectConstructor(target)).set(propertyKey, REMOVED)
}

/**
 * Get object configurable properties by its prototype: the ones of the class and of its parents, the closest
 * declaration of a property winning
 * @param target
 * @constructor
 */
export function getObjectConfigurableProperties<ClassPrototype extends BaseObject>(target: ClassPrototype): ObjectConfigurablePropertyMap {
    return mergedDeclarations(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, objectConstructor(target))
}
