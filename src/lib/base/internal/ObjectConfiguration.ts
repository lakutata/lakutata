import {BaseObject} from '../BaseObject.js'
import {DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {As} from '../func/As.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'
import {ObjectPrototype} from '../func/ObjectPrototype.js'
import {Schema} from 'joi'
import {DTO} from '../../core/DTO.js'

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
    // let objectConfigurablePropertySet: Set<string | symbol>
    let objectConfigurablePropertyMap: ObjectConfigurablePropertyMap<DataType>
    if (Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))) {
        // objectConfigurablePropertySet = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))
        objectConfigurablePropertyMap = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))
    } else {
        // objectConfigurablePropertySet = new Set()
        objectConfigurablePropertyMap = new Map()
        ObjectParentConstructors(ObjectConstructor(target)).forEach((parentConstructor: Function): void => {
            if (Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, parentConstructor))
                As<ObjectConfigurablePropertyMap<DataType>>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, parentConstructor)).forEach((value, key) => objectConfigurablePropertyMap.set(key, value))
        })
    }
    Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, objectConfigurablePropertyMap, ObjectConstructor(target))
    Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target)).set(propertyKey, {
        schema: schema,
        fn: fn ? fn : (value: DataType) => value
    })
}

/**
 * Get object configurable properties by its prototype
 * @param target
 * @constructor
 */
export function GetObjectConfigurableProperties<ClassPrototype extends BaseObject>(target: ClassPrototype): ObjectConfigurablePropertyMap {
    const objectConfigurablePropertyMap: ObjectConfigurablePropertyMap = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))
    if (objectConfigurablePropertyMap) return objectConfigurablePropertyMap
    return new Map()
}
