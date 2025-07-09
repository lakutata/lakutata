import {Controller, type ControllerProperty} from '../../../components/entrypoint/lib/Controller.js'
import {DTO} from '../../../lib/core/DTO.js'
import {MethodDecorator} from '../../../types/MethodDecorator.js'
import {HTTPAction} from '../HTTPAction.js'

export function PUT<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(r: string, dtoConstructor?: DTOConstructor): MethodDecorator<ClassPrototype, Method, ControllerProperty<ClassPrototype>> {
    return dtoConstructor ? HTTPAction<ClassPrototype, Method, DTOConstructor>(r, 'put', dtoConstructor) : HTTPAction<ClassPrototype, Method, DTOConstructor>(r, 'put')
}