import {Controller, type ControllerProperty} from '../../components/entrypoint/lib/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterHTTPAction} from '../../lib/base/internal/ControllerEntrypoint.js'
import {DTO} from '../../lib/core/DTO.js'
import {ActionOptions} from '../../lib/base/internal/ActionOptions.js'
import {GetActionDTOAndOptions} from '../../lib/base/internal/GetActionDTOAndOptions.js'
import {HTTPContext} from '../../lib/context/HTTPContext.js'

/**
 * Method Decorator
 * @param route
 * @param method
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[]): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
