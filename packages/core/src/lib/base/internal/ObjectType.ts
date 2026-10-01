import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {ClassDecorator} from '../../../types/ClassDecorator.js'
import {ObjectParentConstructors} from '@lakutata/utils/helper/ObjectParentConstructors'
import {IsSubclassOf} from '@lakutata/utils/helper/IsSubclassOf'

/**
 * Internal unique symbol
 */
const OBJECT_TYPE: symbol = Symbol('OBJECT.TYPE')

/**
 * Object Type
 */
export enum ObjectType {
    Unknown = 'Unknown',
    Object = 'Object',
    Provider = 'Provider',
    Controller = 'Controller',
    Component = 'Component',
    Module = 'Module'
}

/**
 * BaseObject, registered by its module once it is defined: this module does not import it, BaseObject is decorated by
 * DefineObjectType while it is defined (an import would be a cycle, which fails when the first module loaded imports
 * BaseObject through this module)
 */
let baseObjectConstructor: Function | undefined

/**
 * Register BaseObject
 * @param constructor
 * @constructor
 */
export function RegisterBaseObject(constructor: Function): void {
    baseObjectConstructor = constructor
}

/**
 * Class Decorator
 * @param type
 * @constructor
 */
export function DefineObjectType<ClassConstructor extends IBaseObjectConstructor>(type: ObjectType): ClassDecorator<ClassConstructor> {
    return (target: ClassConstructor) => SetObjectType(target, type)
}

/**
 * Set object type
 * @param target
 * @param type
 * @constructor
 */
export function SetObjectType<ClassConstructor extends IBaseObjectConstructor>(target: ClassConstructor, type: ObjectType): ClassConstructor {
    //BaseObject itself is not its own subclass: it is not registered yet when it is decorated
    Reflect.defineMetadata(OBJECT_TYPE, baseObjectConstructor && IsSubclassOf(target, baseObjectConstructor) ? type : ObjectType.Unknown, target)
    return target
}

/**
 * Get object type
 * @param target
 * @constructor
 */
export function GetObjectType<ClassConstructor extends IBaseObjectConstructor>(target: ClassConstructor): ObjectType {
    if (Reflect.hasOwnMetadata(OBJECT_TYPE, target)) return Reflect.getOwnMetadata(OBJECT_TYPE, target)
    let objectType: ObjectType = ObjectType.Unknown
    for (const parentConstructor of ObjectParentConstructors(target)) {
        if (Reflect.hasOwnMetadata(OBJECT_TYPE, parentConstructor)) {
            objectType = Reflect.getOwnMetadata(OBJECT_TYPE, parentConstructor)
            break
        }
    }
    SetObjectType(target, objectType)
    return GetObjectType(target)
}
