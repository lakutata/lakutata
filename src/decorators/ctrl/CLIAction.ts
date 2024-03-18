import {Controller, ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterCLIAction} from '../../lib/base/internal/ControllerEntrypoint.js'
import {DTO} from '../../lib/core/DTO.js'

/**
 * Method Decorator
 * @constructor
 */
export function CLIAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(command: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO 分解参数
        console.log(dtoConstructor.toJsonSchema())
        RegisterCLIAction(command, target, propertyKey)
        return descriptor
    }
}
