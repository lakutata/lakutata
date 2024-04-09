import {Controller, type ControllerProperty} from '../../core/Controller.js'
import {ObjectConstructor} from '../../helpers/ObjectConstructor.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {Module} from '../../core/Module.js'
import {As} from '../../helpers/As.js'
import {ActionPattern} from '../../../types/ActionPattern.js'
import {ObjectParentConstructors} from '../../helpers/ObjectParentConstructors.js'
import {ObjectHash} from '../../helpers/ObjectHash.js'
import {JSONSchema} from '../../../types/JSONSchema.js'
import {GetObjectNestingDepth} from '../../helpers/GetObjectNestingDepth.js'
import {InvalidActionPatternDepthException} from '../../../exceptions/InvalidActionPatternDepthException.js'
import {DTO} from '../../core/DTO.js'

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

export type ActionDetails<ClassPrototype extends Controller = Controller, DTOConstructor extends typeof DTO = typeof DTO> = {
    pattern: ActionPattern
    constructor: IBaseObjectConstructor<ClassPrototype>
    method: string | number | symbol
    dtoConstructor: DTOConstructor
    jsonSchema: JSONSchema
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
 * Validate action pattern definition
 * @param actionPattern
 */
function ValidateActionPatternDefinition(actionPattern: ActionPattern): ActionPattern {
    const depth: number = GetObjectNestingDepth(actionPattern)
    if (depth > 2) throw new InvalidActionPatternDepthException('The maximum nesting depth of ActionPattern objects cannot be greater than 2 levels. The current nesting depth of the object is {0} levels', [depth])
    return actionPattern
}

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
    actionPattern = ValidateActionPatternDefinition(actionPattern)
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
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function RegisterHTTPAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    route: string,
    methods: string[],
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor): void {
    methods.forEach((method: string) => {
        const actionPattern: ActionPattern = {
            route: route,
            method: method
        }
        RegisterControllerActionPattern(
            ActionPatternManagerType.HTTP,
            As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            actionPattern,
            {
                pattern: actionPattern,
                constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
                method: propertyKey,
                dtoConstructor: dtoConstructor,
                jsonSchema: dtoConstructor.toJsonSchema()
            })
    })
}

/**
 * Register cli action
 * @param command
 * @param controllerPrototype
 * @param propertyKey
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function RegisterCLIAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    command: string,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor): void {
    const actionPattern: ActionPattern = {
        command: command
    }
    RegisterControllerActionPattern(
        ActionPatternManagerType.CLI,
        As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
        actionPattern,
        {
            pattern: actionPattern,
            constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            method: propertyKey,
            dtoConstructor: dtoConstructor,
            jsonSchema: dtoConstructor.toJsonSchema()
        }
    )
}

/**
 * Register service action
 * @param pattern
 * @param controllerPrototype
 * @param propertyKey
 * @param dtoConstructor
 * @param description
 * @constructor
 */
export function RegisterServiceAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    pattern: ActionPattern,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor): void {
    RegisterControllerActionPattern(
        ActionPatternManagerType.Service,
        As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
        pattern,
        {
            pattern: pattern,
            constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            method: propertyKey,
            dtoConstructor: dtoConstructor,
            jsonSchema: dtoConstructor.toJsonSchema()
        }
    )
}
