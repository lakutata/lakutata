import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator, DTO} from '@lakutata/core'
import {RegisterHTTPAction} from '../lib/ControllerEntrypoint.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {GetActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {HTTPContext} from '../context/HTTPContext.js'

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
 * @param method
 * @param dtoConstructor
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param method
 * @param actionOptions
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, method: string, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param method
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param methods
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, methods: string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param methods
 * @param dtoConstructor
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param methods
 * @param actionOptions
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method>(route: string, methods: string[], actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param route
 * @param methods
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>

export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, m: string | string[], dtoConstructorOrOptions?: DTOConstructor | ActionOptions<HTTPContext>, options?: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const route: string = r.toString()
        const methods: string[] = Array.isArray(m) ? m : [m]
        const [dtoConstructor, actionOptions] = GetActionDTOAndOptions(dtoConstructorOrOptions, options)
        RegisterHTTPAction(route, methods, target, propertyKey, dtoConstructor, actionOptions)
        return descriptor
    }
}
