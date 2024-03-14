import {Controller} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'

/**
 * Method Decorator
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO
    }
}
