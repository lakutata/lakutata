import {type Controller, type ControllerProperty} from '../../lib/core/Controller.js'
import {type MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterHTTPAction} from '../../lib/base/internal/ControllerEntrypoint.js'

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
        RegisterHTTPAction(route, methods, target, propertyKey)
        return descriptor
    }
}
