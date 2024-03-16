import {Controller, ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterHTTPAction} from '../../lib/base/internal/ControllerEntrypoint.js'

/**
 * Method Decorator
 * @param route
 * @param method
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method=(a:string)=>void>(route: string, method: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param methods
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method=(a:string)=>void>(route: string, methods: string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function HTTPAction<ClassPrototype extends Controller, Method=(a:string)=>void>(r: string, m: string | string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        const route: string = r.toString()
        const methods: string[] = Array.isArray(m) ? m : [m]
        return RegisterHTTPAction(route, methods, target, propertyKey,descriptor)
    }
}
