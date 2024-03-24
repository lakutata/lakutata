import {PropertyDecorator} from '../../types/PropertyDecorator.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {SetObjectInjectItem} from '../../lib/base/internal/ObjectInjection.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {ConstructorSymbol} from '../../lib/base/internal/ConstructorSymbol.js'
import {ObjectConstructor} from '../../lib/functions/ObjectConstructor.js'
import {As} from '../../lib/functions/As.js'

/**
 * Property Decorator
 * @param name
 * @constructor
 */
export function Inject<ClassPrototype extends BaseObject>(name?: string | symbol | IBaseObjectConstructor<BaseObject>): PropertyDecorator<ClassPrototype> {
    return (target: ClassPrototype, propertyKey: string | symbol) => {
        if (typeof name === 'function') {
            return SetObjectInjectItem(target, propertyKey, ConstructorSymbol(As(ObjectConstructor(name))))
        } else {
            return SetObjectInjectItem(target, propertyKey, name ? name : propertyKey)
        }
    }
}
