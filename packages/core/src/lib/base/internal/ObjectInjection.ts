import {BaseObject} from '../BaseObject.js'
import {
    DI_TARGET_CONSTRUCTOR_AUTOLOAD,
    DI_TARGET_CONSTRUCTOR_INJECTS
} from '../../../constants/DIMetadataKey.js'
import {objectConstructor} from '@lakutata/utils/ObjectConstructor'
import {mergedDeclarations, ownDeclarations, REMOVED} from './MemberDeclarations.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'


export type InjectionName = string | symbol | IBaseObjectConstructor<BaseObject>
export type InjectionTransformFunction = (injection: any) => any | Promise<any>

export type ObjectInjectionMap = Map<string | symbol, {
    //A class is resolved by its constructor symbol, and autoloaded when it is marked so
    name: string | symbol | Function
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
export function setObjectInjectItem<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol, name: string | symbol | Function, transform: InjectionTransformFunction): void {
    ownDeclarations(DI_TARGET_CONSTRUCTOR_INJECTS, objectConstructor(target)).set(propertyKey, {
        name: name,
        transform: transform
    })
}

/**
 * Remove the injection of a property of the parents of a class: the class declares the property otherwise
 * @param target
 * @param propertyKey
 * @constructor
 */
export function removeObjectInjectItem<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    ownDeclarations(DI_TARGET_CONSTRUCTOR_INJECTS, objectConstructor(target)).set(propertyKey, REMOVED)
}

/**
 * Get object inject items by its prototype: the ones of the class and of its parents, the closest declaration of a
 * property winning
 * @param target
 * @constructor
 */
export function getObjectInjectItemsByPrototype<ClassPrototype extends BaseObject>(target: ClassPrototype): ObjectInjectionMap {
    return mergedDeclarations(DI_TARGET_CONSTRUCTOR_INJECTS, objectConstructor(target))
}

/**
 * Mark object as autoload
 * @param target
 * @constructor
 */
export function markObjectAsAutoload<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): ClassConstructor {
    if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_AUTOLOAD, target)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_AUTOLOAD, true, target)
    return target
}

/**
 * Whether an object is autoload object or not
 * @param target
 * @constructor
 */
export function getObjectIsAutoload<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): boolean {
    return !!Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_AUTOLOAD, target)
}
