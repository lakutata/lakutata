import {BaseObject} from '../BaseObject.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'
import {
    DI_TARGET_CONSTRUCTOR_AUTOLOAD,
    DI_TARGET_CONSTRUCTOR_INJECTS
} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {ObjectParentConstructors} from '../func/ObjectParentConstructors.js'
import {ObjectPrototype} from '../func/ObjectPrototype.js'

export type ObjectInjectionMap = Map<string | symbol, {
    name: string | symbol
    constructor: Function | any
}>

/**
 * Set object inject item
 * @param target
 * @param propertyKey
 * @param name
 * @constructor
 */
export function SetObjectInjectItem<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol, name: string | symbol): void {
    let objectInjectionMap: ObjectInjectionMap
    if (Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, ObjectConstructor(target))) {
        objectInjectionMap = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, ObjectConstructor(target))
    } else {
        objectInjectionMap = new Map()
        const parentObjectInjectionMaps: (typeof objectInjectionMap)[] = []
        ObjectParentConstructors(ObjectConstructor(target)).forEach((parentConstructor: Function): void => {
            if (Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, parentConstructor))
                parentObjectInjectionMaps.unshift(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, parentConstructor))
        })
        parentObjectInjectionMaps.forEach((parentObjectInjectionMap: typeof objectInjectionMap): void =>
            parentObjectInjectionMap.forEach((value, key: typeof propertyKey) => objectInjectionMap.set(key, value)))
    }
    const propertyDesignTypeConstructor: Function = Reflect.getMetadata('design:type', target, propertyKey)
    objectInjectionMap.set(propertyKey, {
        name: name,
        constructor: propertyDesignTypeConstructor
    })
    Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, objectInjectionMap, ObjectConstructor(target))
}

/**
 * Get object inject items by its prototype
 * @param target
 * @constructor
 */
export function GetObjectInjectItemsByPrototype<ClassPrototype extends BaseObject>(target: ClassPrototype): ObjectInjectionMap {
    const objectInjectionMap: ObjectInjectionMap = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, ObjectConstructor(target))
    if (objectInjectionMap) return objectInjectionMap
    return new Map()
}

/**
 * Get object inject items by its constructor
 * @param target
 * @constructor
 */
export function GetObjectInjectItemsByConstructor<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): ObjectInjectionMap {
    return GetObjectInjectItemsByPrototype(ObjectPrototype(target))
}

/**
 * Mark object as autoload
 * @param target
 * @constructor
 */
export function MarkObjectAsAutoload<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): ClassConstructor {
    if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_AUTOLOAD, target)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_AUTOLOAD, true, target)
    return target
}

/**
 * Whether an object is autoload object or not
 * @param target
 * @constructor
 */
export function GetObjectIsAutoload<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): boolean {
    return !!Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_AUTOLOAD, target)
}
