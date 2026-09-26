import {Controller, type ControllerProperty} from '../../components/entrypoint/lib/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {ActionPattern} from '../../types/ActionPattern.js'
import {RegisterServiceAction} from '../../components/entrypoint/lib/ControllerEntrypoint.js'
import {DTO} from '../../lib/dto/DTO.js'
import {FlexibleDTO} from '../../lib/dto/FlexibleDTO.js'
import {GetActionDTOAndOptions} from '../../components/entrypoint/lib/GetActionDTOAndOptions.js'
import {ActionOptions} from '../../components/entrypoint/lib/ActionOptions.js'
import {ServiceContext} from '../../lib/context/ServiceContext.js'

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
