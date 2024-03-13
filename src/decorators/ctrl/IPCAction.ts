import {Controller} from '../../lib/core/Controller.js'
import {TMethodDecorator} from '../../types/TMethodDecorator.js'

export function IPCAction<ClassPrototype extends Controller, Method>(): TMethodDecorator<ClassPrototype, Method> {
    return (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => {
        //TODO
    }
}
