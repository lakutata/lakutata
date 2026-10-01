import {Controller, type ControllerProperty} from '../../lib/Controller.js'
import {DTO, MethodDecorator} from '@lakutata/core'
import {HTTPAction} from '../HTTPAction.js'
import {ActionOptions} from '../../lib/ActionOptions.js'
import {HTTPContext} from '../../context/HTTPContext.js'

export function GET<ClassPrototype extends Controller, Method>(r: string): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function GET<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function GET<ClassPrototype extends Controller, Method>(r: string, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function GET<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor: DTOConstructor, actionOptions: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>>
export function GET<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructorOrOptions?: DTOConstructor | ActionOptions<HTTPContext>, options?: ActionOptions<HTTPContext>): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return HTTPAction<ClassPrototype, Method, DTOConstructor>(r, 'get', <any>dtoConstructorOrOptions, <any>options)
}