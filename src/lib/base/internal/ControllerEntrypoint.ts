import {Controller, ControllerProperty} from '../../core/Controller.js'
import {ObjectConstructor} from '../../functions/ObjectConstructor.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {Module} from '../../core/Module.js'
import {As} from '../../functions/As.js'
import {HTTPContext} from '../../context/HTTPContext.js'
import {ActionPattern} from '../../../types/ActionPattern.js'
import {ObjectParentConstructors} from '../../functions/ObjectParentConstructors.js'
import {BaseContext} from '../Context.js'
import {ObjectHash} from '../../functions/ObjectHash.js'
import {CLIContext} from '../../context/CLIContext.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {Container} from '../../core/Container.js'

export enum ActionPatternManagerType {
    HTTP = '_$APMT_HTTP',
    CLI = '_$APMT_CLI',
    Service = '_$APMT_Service'
}

export type ActionPatternMap<Context extends BaseContext> = Map<ActionPattern, ActionHandler<Context>>

export type TotalActionPatternMap = {
    HTTP: ActionPatternMap<HTTPContext>
    CLI: ActionPatternMap<CLIContext>
    Service: ActionPatternMap<ServiceContext>
}

export type ActionHandler<Context extends BaseContext> = (runtimeContainer: Container, context: Context) => Promise<any>

type TotalInternalActionPatternMap = {
    HTTP: InternalActionPatternMap<HTTPContext>
    CLI: InternalActionPatternMap<CLIContext>
    Service: InternalActionPatternMap<ServiceContext>
}

type InternalActionPatternMapValue<Context extends BaseContext> = {
    pattern: ActionPattern
    handler: ActionHandler<Context>
}

type InternalActionPatternMap<Context extends BaseContext> = Map<string, InternalActionPatternMapValue<Context>>

const MODULE_CTRL_MAP: symbol = Symbol('MODULE.CTRL.MAP')

/**
 * Get controller's internal action pattern map
 * @param type
 * @param target
 * @constructor
 */
function GetInternalControllerActionPatternMap<Context extends BaseContext>(type: ActionPatternManagerType, target: IBaseObjectConstructor<Controller>): InternalActionPatternMap<Context> {
    const internalActionPatternMap: InternalActionPatternMap<Context> = new Map()
    ObjectParentConstructors(target).forEach(parentConstructor => {
        const parentActionPatternMap: InternalActionPatternMap<Context> = Reflect.getOwnMetadata(`${type}_MAP`, parentConstructor) || new Map()
        parentActionPatternMap.forEach((value: InternalActionPatternMapValue<Context>, hash: string) => internalActionPatternMap.set(hash, value))
    })
    As<InternalActionPatternMap<Context>>(Reflect.getOwnMetadata(`${type}_MAP`, target) || new Map()).forEach((value: InternalActionPatternMapValue<Context>, hash: string) => internalActionPatternMap.set(hash, value))
    return internalActionPatternMap
}

/**
 * Register pattern to controller
 * @param type
 * @param target
 * @param actionPattern
 * @param handler
 * @constructor
 */
export function RegisterControllerActionPattern<Context extends BaseContext>(type: ActionPatternManagerType, target: IBaseObjectConstructor<Controller>, actionPattern: ActionPattern, handler: ActionHandler<Context>): void {
    const internalActionPatternMap: InternalActionPatternMap<Context> = GetInternalControllerActionPatternMap(type, target)
    internalActionPatternMap.set(ObjectHash(actionPattern), {
        pattern: actionPattern,
        handler: handler
    })
    Reflect.defineMetadata(`${type}_MAP`, internalActionPatternMap, target)
}

/**
 * Bind controller to module
 * @param module
 * @param controllerConstructor
 * @constructor
 */
export function BindControllerToModule(module: Module, controllerConstructor: IBaseObjectConstructor<Controller>): void {
    const totalInternalActionPatternMap: TotalInternalActionPatternMap = Reflect.getOwnMetadata(MODULE_CTRL_MAP, module) || {
        CLI: new Map(),
        HTTP: new Map(),
        Service: new Map()
    }
    GetInternalControllerActionPatternMap(ActionPatternManagerType.CLI, controllerConstructor).forEach((value: InternalActionPatternMapValue<CLIContext>, hash: string) => totalInternalActionPatternMap.CLI.set(hash, value))
    GetInternalControllerActionPatternMap(ActionPatternManagerType.HTTP, controllerConstructor).forEach((value: InternalActionPatternMapValue<HTTPContext>, hash: string) => totalInternalActionPatternMap.HTTP.set(hash, value))
    GetInternalControllerActionPatternMap(ActionPatternManagerType.Service, controllerConstructor).forEach((value: InternalActionPatternMapValue<ServiceContext>, hash: string) => totalInternalActionPatternMap.Service.set(hash, value))
    Reflect.defineMetadata(MODULE_CTRL_MAP, totalInternalActionPatternMap, module)
}

/**
 * Get module controller action map
 * @param module
 * @constructor
 */
export function GetModuleControllerActionMap(module: Module): TotalActionPatternMap {
    const totalInternalActionPatternMap: TotalInternalActionPatternMap = Reflect.getOwnMetadata(MODULE_CTRL_MAP, module) || {
        CLI: new Map(),
        HTTP: new Map(),
        Service: new Map()
    }
    const totalActionPatternMap: TotalActionPatternMap = {
        CLI: new Map(),
        HTTP: new Map(),
        Service: new Map()
    }
    totalInternalActionPatternMap.CLI.forEach((value: InternalActionPatternMapValue<CLIContext>) => totalActionPatternMap.CLI.set(value.pattern, value.handler))
    totalInternalActionPatternMap.HTTP.forEach((value: InternalActionPatternMapValue<HTTPContext>) => totalActionPatternMap.HTTP.set(value.pattern, value.handler))
    totalInternalActionPatternMap.Service.forEach((value: InternalActionPatternMapValue<ServiceContext>) => totalActionPatternMap.Service.set(value.pattern, value.handler))
    return totalActionPatternMap
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
        RegisterControllerActionPattern(
            ActionPatternManagerType.HTTP,
            As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            {
                route: route,
                method: method
            },
            async (runtimeContainer: Container, context: HTTPContext) => {
                const controller: ClassPrototype = await runtimeContainer.get(As<IBaseObjectConstructor<ClassPrototype>>(ObjectConstructor(controllerPrototype)), {
                    context: context
                })
                // return As<Function>(controller[propertyKey])()//TODO 向方法传入参数
                return 'fuck'
            })
    })
}
