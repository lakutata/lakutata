import {Controller, type ControllerProperty} from '../../lib/core/Controller.js'
import {MethodDecorator} from '../../types/MethodDecorator.js'
import {RegisterHTTPAction} from '../../lib/base/internal/ControllerEntrypoint.js'
import {DTO} from '../../lib/core/DTO.js'

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
 * @param description
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, method: string, dtoConstructor: DTOConstructor, description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
 * @param description
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
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
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(route: string, methods: string[], dtoConstructor: DTOConstructor, description: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function HTTPAction<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, m: string | string[], descriptionOrDTOConstructor?: string | DTOConstructor, description?: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return (target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>) => {
        const route: string = r.toString()
        const methods: string[] = Array.isArray(m) ? m : [m]
        if (!descriptionOrDTOConstructor) {
            RegisterHTTPAction(route, methods, target, propertyKey, DTO, '')
        } else if (typeof descriptionOrDTOConstructor === 'string') {
            RegisterHTTPAction(route, methods, target, propertyKey, DTO, descriptionOrDTOConstructor)
        } else {
            RegisterHTTPAction(route, methods, target, propertyKey, descriptionOrDTOConstructor, description ? description : '')
        }
        return descriptor
    }
}
