import {Controller, ControllerProperty} from '../../core/Controller.js'
import {ObjectConstructor} from '../../functions/ObjectConstructor.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {decorate} from 'reflect-metadata/no-conflict'
import {PatternManager} from './PatternManager.js'
import {Module} from '../../core/Module.js'
import {As} from '../../functions/As.js'
import {HTTPContext} from '../../context/HTTPContext.js'

const HTTP_ACTION_MAP: symbol = Symbol('ACTION.HTTP.MAP')
const CLI_ACTION_MAP: symbol = Symbol('ACTION.CLI.MAP')
const SERVICE_ACTION_MAP: symbol = Symbol('ACTION.SERVICE.MAP')

const patternManagers = {
    http: new PatternManager(),
    cli: new PatternManager(),
    service: new PatternManager()
}

type HTTPActionRecord<ClassConstructor extends IBaseObjectConstructor<Controller> = IBaseObjectConstructor<Controller>> = {
    method: ClassConstructor
    constructor: any
    propertyKey: string | symbol
}

/**
 * Register http action
 * @param route
 * @param methods
 * @param controllerPrototype
 * @param propertyKey
 * @param descriptor
 * @constructor
 */
export function RegisterHTTPAction<ClassPrototype extends Controller, Method>(route: string, methods: string[], controllerPrototype: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, descriptor: TypedPropertyDescriptor<Method>): void {
    methods.forEach((method: string) => {
        patternManagers.http.add({
            route: route,
            method: method
        }, async (module: Module, context: HTTPContext) => {
            const controller: ClassPrototype = await module.getObject(As<IBaseObjectConstructor<ClassPrototype>>(ObjectConstructor(controllerPrototype)), {
                context: context
            })
            As<Function>(controller[propertyKey])()
        })
    })
}
