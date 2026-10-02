import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES} from '../../../constants/DIMetadataKey.js'
import {DTO} from '../../dto/DTO.js'
import {Schema} from '../../validation/types/Schema.js'
import {ObjectConstructor} from '@lakutata/utils/ObjectConstructor'
import {MergedDeclarations, OwnDeclarations, REMOVED} from './MemberDeclarations.js'

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
export function SetObjectConfigurableProperty<ClassPrototype extends BaseObject, DataType>(target: ClassPrototype, propertyKey: string | symbol, schema: Schema<DataType> = DTO.Any(), fn?: (value: DataType) => DataType | Promise<DataType>): void {
    OwnDeclarations(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target)).set(propertyKey, {
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
export function RemoveObjectConfigurableProperty<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    OwnDeclarations(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target)).set(propertyKey, REMOVED)
}

/**
 * Get object configurable properties by its prototype: the ones of the class and of its parents, the closest
 * declaration of a property winning
 * @param target
 * @constructor
 */
export function GetObjectConfigurableProperties<ClassPrototype extends BaseObject>(target: ClassPrototype): ObjectConfigurablePropertyMap {
    return MergedDeclarations(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))
}
