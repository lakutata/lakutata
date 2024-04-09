import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {
    InjectionName,
    InjectionTransformFunction,
    SetObjectInjectItem
} from '../../lib/base/internal/ObjectInjection.js'
import {ConstructorSymbol} from '../../lib/base/internal/ConstructorSymbol.js'
import {isClass} from '../../lib/ioc/Utils.js'
import {As} from '../../lib/helpers/As.js'

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
    return (target: ClassPrototype, propertyKey: string | symbol) => {
        let injectionName: InjectionName = propertyKey
        let injectionTransform: InjectionTransformFunction = (injection) => injection
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
        return typeof injectionName === 'function'
            ? SetObjectInjectItem(target, propertyKey, ConstructorSymbol(injectionName), injectionTransform)
            : SetObjectInjectItem(target, propertyKey, injectionName, injectionTransform)
    }
}
