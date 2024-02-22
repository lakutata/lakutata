import {BaseObject} from '../BaseObject.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'

/**
 * Set object inject item
 * @param target
 * @param propertyKey
 * @constructor
 */
export function SetObjectInject<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    ObjectConstructor(target)
    //todo
}
