import {Controller} from '../../lib/core/Controller.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'

/**
 * Method Decorator
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method>(): TMethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO
    }
}
