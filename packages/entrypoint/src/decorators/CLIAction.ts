import {Controller, type ControllerProperty} from '../lib/Controller.js'
import {MethodDecorator, DTO} from '@lakutata/core'
import {RegisterCLIAction} from '../lib/ControllerEntrypoint.js'
import {ActionOptions} from '../lib/ActionOptions.js'
import {GetActionDTOAndOptions} from '../lib/GetActionDTOAndOptions.js'
import {CLIContext} from '../context/CLIContext.js'

/**
 * Method Decorator
 * @param command
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param command
 * @param dtoConstructor
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param command
 * @param actionOptions
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, actionOptions: ActionOptions<CLIContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param command
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<CLIContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>

export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<CLIContext>, options?: ActionOptions<CLIContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        const [dtoConstructor, actionOptions] = GetActionDTOAndOptions(dtoConstructorOrOptions, options)
        RegisterCLIAction(command, target, propertyKey, dtoConstructor, ActionOptions.validate(actionOptions))
        return descriptor
    }
}
