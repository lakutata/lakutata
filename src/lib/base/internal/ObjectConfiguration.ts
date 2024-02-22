import {BaseObject} from '../BaseObject.js'
import {defineMetadata, getOwnMetadata, hasOwnMetadata} from 'reflect-metadata/no-conflict'
import {DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {As} from '../func/As.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'
import {ObjectPrototype} from '../func/ObjectPrototype.js'

/**
 * Add object configurable property to Set
 * @param target
 * @param propertyKey
 * @constructor
 */
export function SetObjectConfigurableProperty<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    let objectConfigurablePropertySet: Set<string | symbol>
    if (hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))) {
        objectConfigurablePropertySet = getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))
    } else {
        objectConfigurablePropertySet = new Set()
        ObjectParentConstructors(ObjectConstructor(target)).forEach((parentConstructor: Function): void => {
            if (hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, parentConstructor))
                As<Set<string | symbol>>(getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, parentConstructor)).forEach((value: string | symbol) => objectConfigurablePropertySet.add(value))
        })
    }
    defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, objectConfigurablePropertySet, ObjectConstructor(target))
    getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target)).add(propertyKey)
}

/**
 * Get object configurable properties by its prototype
 * @param target
 * @constructor
 */
export function GetObjectConfigurablePropertiesByPrototype<ClassPrototype extends BaseObject>(target: ClassPrototype): Set<string | symbol> {
    const objectConfigurablePropertySet: Set<string | symbol> = getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, ObjectConstructor(target))
    if (objectConfigurablePropertySet) return objectConfigurablePropertySet
    return new Set()
}

/**
 * Get object configurable properties by its constructor
 * @param target
 * @constructor
 */
export function GetObjectConfigurablePropertiesByConstructor<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): Set<string | symbol> {
    return GetObjectConfigurablePropertiesByPrototype(ObjectPrototype(target))
}
