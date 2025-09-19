import {Controller, type ControllerProperty} from '../../components/entrypoint/lib/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterCLIAction} from '../../lib/base/internal/ControllerEntrypoint.js'
import {DTO} from '../../lib/core/DTO.js'
import {ActionOptions} from '../../lib/base/internal/ActionOptions.js'
import {GetActionDTOAndOptions} from '../../lib/base/internal/GetActionDTOAndOptions.js'
import {CLIContext} from '../../lib/context/CLIContext.js'

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
