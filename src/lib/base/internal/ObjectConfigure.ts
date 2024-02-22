import {BaseObject} from '../BaseObject.js'
import {defineMetadata, getOwnMetadata, hasOwnMetadata} from 'reflect-metadata/no-conflict'
import {DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {GetObjectConstructor} from '../func/GetObjectConstructor.js'
import {ParentConstructor} from '../func/ParentConstructor.js'
import {As} from '../func/As.js'

export function SetObjectConfigurableProperty<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    let objectConfigurablePropertySet: Set<string | symbol>
    if (hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, GetObjectConstructor(target))) {
        objectConfigurablePropertySet = getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, GetObjectConstructor(target))
    } else {
        objectConfigurablePropertySet = new Set()
        let parentConstructor: Function | null = ParentConstructor(GetObjectConstructor(target))
        while (parentConstructor) {
            if (hasOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, parentConstructor))
                As<Set<string | symbol>>(getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, parentConstructor)).forEach((value: string | symbol) => objectConfigurablePropertySet.add(value))
            parentConstructor = ParentConstructor(parentConstructor)
        }
    }
    defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, objectConfigurablePropertySet, GetObjectConstructor(target))
    getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, GetObjectConstructor(target)).add(propertyKey)
}

export function GetObjectConfigurablePropertiesByPrototype<ClassPrototype extends BaseObject>(target: ClassPrototype): Set<string | symbol> {
    const objectConfigurablePropertySet: Set<string | symbol> = getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, GetObjectConstructor(target))
    if (objectConfigurablePropertySet) return objectConfigurablePropertySet
    return new Set()
}

export function GetObjectConfigurablePropertiesByConstructor<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): Set<string | symbol> {
    const objectConfigurablePropertySet: Set<string | symbol> = getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES, target)
    if (objectConfigurablePropertySet) return objectConfigurablePropertySet
    return new Set()
}
