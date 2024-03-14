import {Controller, ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'

/**
 * Method Decorator
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO
    }
}
