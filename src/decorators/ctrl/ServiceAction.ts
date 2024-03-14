import {Controller} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {ActionPattern} from '../../types/ActionPattern.js'

/**
 * Method Decorator
 * @param pattern
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method=()=>void>(pattern: ActionPattern): MethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO
    }
}
