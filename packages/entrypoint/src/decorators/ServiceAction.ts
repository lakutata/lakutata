import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator} from '@lakutata/core'
import {ActionPattern} from '@lakutata/core'
import {RegisterServiceAction} from '../lib/ControllerEntrypoint.js'
import {DTO} from '@lakutata/core'
import {FlexibleDTO} from '@lakutata/core/internal'
import {GetActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {ServiceContext} from '../context/ServiceContext.js'

/**
 * Method Decorator
 * @param pattern
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param pattern
 * @param dtoConstructor
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param pattern
 * @param actionOptions
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, actionOptions: ActionOptions<ServiceContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param pattern
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<ServiceContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>

export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<ServiceContext>, options?: ActionOptions<ServiceContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const [dtoConstructor, actionOptions] = GetActionDTOAndOptions(dtoConstructorOrOptions, options)
        RegisterServiceAction(pattern, target, propertyKey, dtoConstructor, actionOptions)
        return descriptor
    }
}
