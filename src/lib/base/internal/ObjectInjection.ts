import {BaseObject} from '../BaseObject.js'
import {ObjectConstructor} from '../func/ObjectConstructor.js'

export function SetObjectInject<ClassPrototype extends BaseObject>(target: ClassPrototype, propertyKey: string | symbol): void {
    ObjectConstructor(target)
    //todo
}
