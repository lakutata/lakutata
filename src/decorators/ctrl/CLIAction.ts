import {Controller, type ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterCLIAction} from '../../lib/base/internal/ControllerEntrypoint.js'
import {DTO} from '../../lib/core/DTO.js'

/**
 * Method Decorator
 * @param command
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param command
 * @param description
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, description?: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructor: DTOConstructor, description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, descriptionOrDTOConstructor?: string | DTOConstructor, description?: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        if (!descriptionOrDTOConstructor) {
            RegisterCLIAction(command, target, propertyKey, DTO, '')
        } else if (typeof descriptionOrDTOConstructor === 'string') {
            RegisterCLIAction(command, target, propertyKey, DTO, descriptionOrDTOConstructor)
        } else {
            RegisterCLIAction(command, target, propertyKey, descriptionOrDTOConstructor, description ? description : '')
        }
        return descriptor
    }
}
