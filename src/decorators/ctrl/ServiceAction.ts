import {Controller, type ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {ActionPattern} from '../../types/ActionPattern.js'
import {RegisterServiceAction} from '../../lib/base/internal/ControllerEntrypoint.js'
import {DTO} from '../../lib/core/DTO.js'

/**
 * Method Decorator
 * @param pattern
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
/**
 * Method Decorator
 * @param pattern
 * @param description
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, dtoConstructor: DTOConstructor, description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function ServiceAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(pattern: ActionPattern, descriptionOrDTOConstructor?: string | DTOConstructor, description?: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        if (!descriptionOrDTOConstructor) {
            RegisterServiceAction(pattern, target, propertyKey, DTO, '')
        } else if (typeof descriptionOrDTOConstructor === 'string') {
            RegisterServiceAction(pattern, target, propertyKey, DTO, descriptionOrDTOConstructor)
        } else {
            RegisterServiceAction(pattern, target, propertyKey, descriptionOrDTOConstructor, description ? description : '')
        }
        return descriptor
    }
}
