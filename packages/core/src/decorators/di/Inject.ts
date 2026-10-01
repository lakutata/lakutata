import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {
    InjectionName,
    InjectionTransformFunction,
    SetObjectInjectItem
} from '../../lib/base/internal/ObjectInjection.js'
import {isClass} from '../../lib/ioc/Utils.js'
import {As} from '@lakutata/utils/As'

/**
 *
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(): PropertyDecorator<ClassPrototype>
/**
 * Property Decorator
 * @param name
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(name: InjectionName): PropertyDecorator<ClassPrototype>
/**
 * Property Decorator
 * @param transform
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(transform: InjectionTransformFunction): PropertyDecorator<ClassPrototype>
/**
 * Property Decorator
 * @param name
 * @param transform
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(name: InjectionName, transform: InjectionTransformFunction): PropertyDecorator<ClassPrototype>
export function Inject<ClassPrototype extends BaseObject>(nameOrTransform?: InjectionName | InjectionTransformFunction, transform?: InjectionTransformFunction): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol): void => {
        let injectionName: InjectionName = propertyKey
        let injectionTransform: InjectionTransformFunction = (injection: any): any => injection
        if (nameOrTransform || transform) {
            if (transform) {
                injectionName = As<InjectionName>(nameOrTransform)
                injectionTransform = transform
            } else {
                if (typeof nameOrTransform === 'function') {
                    if (isClass(nameOrTransform)) {
                        injectionName = As<InjectionName>(nameOrTransform)
                    } else {
                        injectionTransform = As<InjectionTransformFunction>(nameOrTransform)
                    }
                } else {
                    injectionName = As<InjectionName>(nameOrTransform)
                }
            }
        }
        //A class is kept as it is: the container resolves it by its constructor symbol, and autoloads it when it is marked so
        return SetObjectInjectItem(target, propertyKey, injectionName, injectionTransform)
    }
}
