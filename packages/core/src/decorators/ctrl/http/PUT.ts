import {Controller, type ControllerProperty} from '../../../components/entrypoint/lib/Controller.js'
import {DTO} from '../../../lib/core/DTO.js'
import {MethodDecorator} from '../../../types/MethodDecorator.js'
import {HTTPAction} from '../HTTPAction.js'
import {ActionOptions} from '../../../lib/base/internal/ActionOptions.js'
import {HTTPContext} from '../../../lib/context/HTTPContext.js'

export function PUT<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function PUT<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function PUT<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function PUT<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function PUT<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<HTTPContext>, options?: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return HTTPAction<ClassPrototype, Method, DTOConstructor>(r, 'put', <any>dtoConstructorOrOptions, <any>options)
}