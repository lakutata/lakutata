import {BaseObject} from '../BaseObject.js'
import {
    DI_TARGET_CONSTRUCTOR_AUTOLOAD,
    DI_TARGET_CONSTRUCTOR_INJECTS
} from '../../../constants/DIMetadataKey.js'
import {ObjectConstructor} from '../../functions/ObjectConstructor.js'
import {ObjectParentConstructors} from '../../functions/ObjectParentConstructors.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'


export type InjectionName = string | symbol | IBaseObjectConstructor<BaseObject>
export type InjectionTransformFunction = (injection: any) => any | Promise<any>

export type ObjectInjectionMap = Map<string | symbol, {
    name: string | symbol
    transform: InjectionTransformFunction
}>


/**
 * Set object inject item
 * @param target
 * @param propertyKey
 * @param name
 * @param transform
 * @constructor
 */
export function SetObjectInjectItem<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol, name: string | symbol, transform: InjectionTransformFunction): void {
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
    objectInjectionMap.set(propertyKey, {
        name: name,
        transform: transform
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
