import {Controller, ControllerProperty} from '../../core/Controller.js'
import {ObjectConstructor} from '../../functions/ObjectConstructor.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {Module} from '../../core/Module.js'
import {As} from '../../functions/As.js'
import {ActionPattern} from '../../../types/ActionPattern.js'
import {ObjectParentConstructors} from '../../functions/ObjectParentConstructors.js'
import {ObjectHash} from '../../functions/ObjectHash.js'

export enum ActionPatternManagerType {
    HTTP = '_$APMT_HTTP',
    CLI = '_$APMT_CLI',
    Service = '_$APMT_Service'
}

export type ActionPatternMap = Map<ActionPattern, ActionDetails>

export type TotalActionPatternMap = {
    HTTP: ActionPatternMap
    CLI: ActionPatternMap
    Service: ActionPatternMap
}

export type ActionDetails<ClassPrototype extends Controller = Controller> = {
    constructor: IBaseObjectConstructor<ClassPrototype>
    method: string | number | symbol
}

type TotalInternalActionPatternMap = {
    HTTP: InternalActionPatternMap
    CLI: InternalActionPatternMap
    Service: InternalActionPatternMap
}

type InternalActionPatternMapValue = {
    pattern: ActionPattern
    details: ActionDetails
}

type InternalActionPatternMap = Map<string, InternalActionPatternMapValue>

const MODULE_CTRL_MAP: symbol = Symbol('MODULE.CTRL.MAP')

/**
 * Get controller's internal action pattern map
 * @param type
 * @param target
 * @constructor
 */
function GetInternalControllerActionPatternMap(type: ActionPatternManagerType, target: IBaseObjectConstructor<Controller>): InternalActionPatternMap {
    const internalActionPatternMap: InternalActionPatternMap = new Map()
    ObjectParentConstructors(target).forEach(parentConstructor => {
        const parentActionPatternMap: InternalActionPatternMap = Reflect.getOwnMetadata(`${type}_MAP`, parentConstructor) || new Map()
        parentActionPatternMap.forEach((value: InternalActionPatternMapValue, hash: string) => internalActionPatternMap.set(hash, value))
    })
    As<InternalActionPatternMap>(Reflect.getOwnMetadata(`${type}_MAP`, target) || new Map()).forEach((value: InternalActionPatternMapValue, hash: string) => internalActionPatternMap.set(hash, value))
    return internalActionPatternMap
}

/**
 * Register pattern to controller
 * @param type
 * @param target
 * @param actionPattern
 * @param details
 * @constructor
 */
export function RegisterControllerActionPattern(type: ActionPatternManagerType, target: IBaseObjectConstructor<Controller>, actionPattern: ActionPattern, details: ActionDetails): void {
    const internalActionPatternMap: InternalActionPatternMap = GetInternalControllerActionPatternMap(type, target)
    internalActionPatternMap.set(ObjectHash(actionPattern), {
        pattern: actionPattern,
        details: details
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
    GetInternalControllerActionPatternMap(ActionPatternManagerType.CLI, controllerConstructor).forEach((value: InternalActionPatternMapValue, hash: string) => totalInternalActionPatternMap.CLI.set(hash, value))
    GetInternalControllerActionPatternMap(ActionPatternManagerType.HTTP, controllerConstructor).forEach((value: InternalActionPatternMapValue, hash: string) => totalInternalActionPatternMap.HTTP.set(hash, value))
    GetInternalControllerActionPatternMap(ActionPatternManagerType.Service, controllerConstructor).forEach((value: InternalActionPatternMapValue, hash: string) => totalInternalActionPatternMap.Service.set(hash, value))
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
    totalInternalActionPatternMap.CLI.forEach((value: InternalActionPatternMapValue) => totalActionPatternMap.CLI.set(value.pattern, value.details))
    totalInternalActionPatternMap.HTTP.forEach((value: InternalActionPatternMapValue) => totalActionPatternMap.HTTP.set(value.pattern, value.details))
    totalInternalActionPatternMap.Service.forEach((value: InternalActionPatternMapValue) => totalActionPatternMap.Service.set(value.pattern, value.details))
    return totalActionPatternMap
}

/**
 * Register http action
 * @param route
 * @param methods
 * @param controllerPrototype
 * @param propertyKey
 * @constructor
 */
export function RegisterHTTPAction<ClassPrototype extends Controller>(route: string, methods: string[], controllerPrototype: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>): void {
    methods.forEach((method: string) => {
        RegisterControllerActionPattern(
            ActionPatternManagerType.HTTP,
            As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            {
                route: route,
                method: method
            },
            {
                constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
                method: propertyKey
            })
    })
}

export function RegisterCLIAction<ClassPrototype extends Controller>(controllerPrototype: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>): void {
}

/**
 * Register service action
 * @param pattern
 * @param controllerPrototype
 * @param propertyKey
 * @constructor
 */
export function RegisterServiceAction<ClassPrototype extends Controller>(pattern: ActionPattern, controllerPrototype: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>): void {
    RegisterControllerActionPattern(
        ActionPatternManagerType.Service,
        As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
        pattern,
        {
            constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            method: propertyKey
        }
    )
}
