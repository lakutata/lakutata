import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {TClassDecorator} from '../../../types/TClassDecorator.js'
import {ObjectParentConstructors} from '../../functions/ObjectParentConstructors.js'
import {DTO} from '../../core/DTO.js'
import {BaseObject} from '../BaseObject.js'

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
 * Class Decorator
 * @param type
 * @constructor
 */
export function DefineObjectType<ClassConstructor extends IBaseObjectConstructor>(type: ObjectType): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor) => SetObjectType(target, type)
}

/**
 * Set object type
 * @param target
 * @param type
 * @constructor
 */
export function SetObjectType<ClassConstructor extends IBaseObjectConstructor>(target: ClassConstructor, type: ObjectType): ClassConstructor {
    Reflect.defineMetadata(OBJECT_TYPE, DTO.isValid(target, DTO.Class(BaseObject)) ? type : ObjectType.Unknown, target)
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
