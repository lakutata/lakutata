import {Controller, type ControllerProperty} from './Controller.js'
import {ObjectConstructor} from '@lakutata/core/helper'
import {IBaseObjectConstructor} from '@lakutata/core'
import {As} from '@lakutata/core/helper'
import {ActionPattern} from '@lakutata/core'
import {ObjectParentConstructors} from '@lakutata/core/helper'
import {ObjectHash} from '@lakutata/core/helper'
import {JSONSchema} from '@lakutata/core'
import {GetObjectNestingDepth} from '@lakutata/core/helper'
import {InvalidActionPatternDepthException} from '@lakutata/core'
import {DTO} from '@lakutata/core'
import {Component} from '@lakutata/core'
import {UUID} from '@lakutata/core/helper'
import {ActionOptions} from './ActionOptions.js'
import {StringifyPattern} from './StringifyPattern.js'
import {CLIContext} from '../context/CLIContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import type {AccessControlRuleHandler} from './AccessControlRule.js'
import {MiddlewareDefinition, ValidateMiddlewares} from './Middleware.js'
import {GetPrefix, PrefixCommand, PrefixOptions, PrefixPattern, PrefixRoute} from './Prefix.js'

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

export type ActionDetails<ClassPrototype extends Controller = Controller, DTOConstructor extends typeof DTO = typeof DTO> =
    {
        pattern: ActionPattern
        constructor: IBaseObjectConstructor<ClassPrototype>
        method: string | number | symbol
        dtoConstructor: DTOConstructor
        jsonSchema: JSONSchema
        middlewares: MiddlewareDefinition[]
        getActionInfo: () => ActionInfo
    }
    & ActionInfo

export type ActionInfo = {
    id: string
    acl: boolean
    action: string
    name: string
    description: string
    groups: string[]
    rule?: AccessControlRuleHandler<any>
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

const COMPONENT_CTRL_MAP: symbol = Symbol('COMPONENT.CTRL.MAP')

/**
 * Get action info
 * @param controllerPrototype
 * @param propertyKey
 * @param actionOptions
 * @param extra
 */
function getActionInfo<ClassPrototype extends Controller>(controllerPrototype: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>, actionOptions: ActionOptions<any>, extra: string): ActionInfo {
    const action: string = `${As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)).className}:${String(propertyKey)}`
    const id: string = UUID.v5(`${action}:${extra}`, UUID.NIL)
    const name: string = actionOptions.name ? actionOptions.name : action
    const description: string = actionOptions.description ? actionOptions.description : ''
    return {
        id: id,
        acl: !!actionOptions.acl,
        action: action,
        name: name,
        description: description,
        groups: actionOptions.groups ? actionOptions.groups : [],
        rule: actionOptions.rule
    }
}

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
 * Bind controller to component
 * @param component
 * @param controllerConstructor
 * @constructor
 */
export function BindControllerToComponent(component: Component, controllerConstructor: IBaseObjectConstructor<Controller>): void {
    const totalInternalActionPatternMap: TotalInternalActionPatternMap = Reflect.getOwnMetadata(COMPONENT_CTRL_MAP, component) || {
        CLI: new Map(),
        HTTP: new Map(),
        Service: new Map()
    }
    const prefix: PrefixOptions | undefined = GetPrefix(controllerConstructor)
    //The actions inherited from a parent controller are run by the registered controller
    const bind = (type: ActionPatternManagerType, value: InternalActionPatternMapValue): [string, InternalActionPatternMapValue] => {
        const details: ActionDetails = {...value.details, constructor: controllerConstructor}
        let pattern: ActionPattern = value.pattern
        let extra: string | undefined
        if (type === ActionPatternManagerType.HTTP && prefix?.route !== undefined) {
            pattern = {...pattern, route: PrefixRoute(prefix.route, pattern.route)}
            extra = pattern.route
        } else if (type === ActionPatternManagerType.CLI && prefix?.command !== undefined) {
            pattern = {command: PrefixCommand(prefix.command, pattern.command)}
            extra = pattern.command
        } else if (type === ActionPatternManagerType.Service && prefix?.pattern !== undefined) {
            pattern = ValidateActionPatternDefinition(PrefixPattern(prefix.pattern, pattern))
            extra = StringifyPattern(pattern)
        }
        if (extra !== undefined) {
            //A prefixed action is named after the registered controller, so the controllers sharing a parent have distinct actions
            const action: string = `${controllerConstructor.className}:${String(details.method)}`
            details.name = details.name === details.action ? action : details.name
            details.action = action
            details.id = UUID.v5(`${action}:${extra}`, UUID.NIL)
            details.pattern = pattern
            const actionInfo: ActionInfo = {id: details.id, acl: details.acl, action: action, name: details.name, description: details.description, groups: details.groups, rule: details.rule}
            details.getActionInfo = (): ActionInfo => actionInfo
        }
        return [extra === undefined ? '' : ObjectHash(pattern), {pattern: pattern, details: details}]
    }
    const add = (type: ActionPatternManagerType, map: InternalActionPatternMap): void => GetInternalControllerActionPatternMap(type, controllerConstructor).forEach((value: InternalActionPatternMapValue, hash: string): void => {
        const [prefixedHash, bound] = bind(type, value)
        map.set(prefixedHash || hash, bound)
    })
    add(ActionPatternManagerType.CLI, totalInternalActionPatternMap.CLI)
    add(ActionPatternManagerType.HTTP, totalInternalActionPatternMap.HTTP)
    add(ActionPatternManagerType.Service, totalInternalActionPatternMap.Service)
    Reflect.defineMetadata(COMPONENT_CTRL_MAP, totalInternalActionPatternMap, component)
}

/**
 * Get module controller action map
 * @constructor
 * @param component
 */
export function GetComponentControllerActionMap(component: Component): TotalActionPatternMap {
    const totalInternalActionPatternMap: TotalInternalActionPatternMap = Reflect.getOwnMetadata(COMPONENT_CTRL_MAP, component) || {
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
 * @param actionOptions
 * @constructor
 */
export function RegisterHTTPAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    route: string,
    methods: string[],
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<HTTPContext>
): void {
    methods.forEach((method: string) => {
        const actionPattern: ActionPattern = {
            route: route,
            method: method
        }
        const actionInfo: ActionInfo = getActionInfo(controllerPrototype, propertyKey, actionOptions, route)
        RegisterControllerActionPattern(
            ActionPatternManagerType.HTTP,
            As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            actionPattern,
            {
                ...actionInfo,
                pattern: actionPattern,
                constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
                method: propertyKey,
                dtoConstructor: dtoConstructor,
                jsonSchema: dtoConstructor.toJsonSchema(),
                middlewares: ValidateMiddlewares(actionOptions.middlewares ?? []),
                getActionInfo: () => actionInfo
            })
    })
}

/**
 * Register cli action
 * @param command
 * @param controllerPrototype
 * @param propertyKey
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function RegisterCLIAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    command: string,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<CLIContext>
): void {
    const actionPattern: ActionPattern = {
        command: command
    }
    const actionInfo: ActionInfo = getActionInfo(controllerPrototype, propertyKey, actionOptions, command)
    RegisterControllerActionPattern(
        ActionPatternManagerType.CLI,
        As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
        actionPattern,
        {
            ...actionInfo,
            pattern: actionPattern,
            constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            method: propertyKey,
            dtoConstructor: dtoConstructor,
            jsonSchema: dtoConstructor.toJsonSchema(),
            middlewares: ValidateMiddlewares(actionOptions.middlewares ?? []),
            getActionInfo: () => actionInfo
        }
    )
}

/**
 * Register service action
 * @param pattern
 * @param controllerPrototype
 * @param propertyKey
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function RegisterServiceAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    pattern: ActionPattern,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<ServiceContext>
): void {
    const flattenPattern: string = StringifyPattern(pattern)
    const actionInfo: ActionInfo = getActionInfo(controllerPrototype, propertyKey, actionOptions, flattenPattern)
    RegisterControllerActionPattern(
        ActionPatternManagerType.Service,
        As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
        pattern,
        {
            ...actionInfo,
            pattern: pattern,
            constructor: As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype)),
            method: propertyKey,
            dtoConstructor: dtoConstructor,
            jsonSchema: dtoConstructor.toJsonSchema(),
            middlewares: ValidateMiddlewares(actionOptions.middlewares ?? []),
            getActionInfo: () => actionInfo
        }
    )
}
