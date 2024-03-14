import {Controller, ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {ActionPattern} from '../../types/ActionPattern.js'

/**
 * Method Decorator
 * @param pattern
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method>(pattern: ActionPattern): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO
    }
}
