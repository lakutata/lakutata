import {Controller, ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'

/**
 * Method Decorator
 * @param route
 * @param method
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, method: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param methods
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, methods: string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function HTTPAction<ClassPrototype extends Controller, Method>(r: string, m: string | string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        const route: string = r.toString()
        const methods: string[] = Array.isArray(m) ? m : [m]
        //TODO
    }
}
