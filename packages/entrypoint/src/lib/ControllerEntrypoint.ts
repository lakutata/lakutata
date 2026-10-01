import {Controller, type ControllerProperty} from './Controller.js'
import {ObjectConstructor} from '@lakutata/utils'
import {IBaseObjectConstructor} from '@lakutata/core'
import {As} from '@lakutata/utils'
import {ActionPattern} from '@lakutata/core'
import {ObjectParentConstructors} from '@lakutata/utils'
import {ObjectHash} from '@lakutata/utils'
import {JSONSchema} from '@lakutata/core'
import {GetObjectNestingDepth} from '@lakutata/utils'
import {InvalidActionPatternDepthException} from '@lakutata/core'
import {DTO} from '@lakutata/core'
import {Component} from '@lakutata/core'
import {UUID} from '@lakutata/utils'
import {ActionOptions} from './ActionOptions.js'
import {CLIContext} from '../context/CLIContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import type {AccessControlRuleHandler} from './AccessControlRule.js'
import {MiddlewareDefinition, ValidateMiddlewares} from './Middleware.js'
import {GetPrefix, PrefixOptions} from './Prefix.js'
import {ChannelDefinition, GetChannel} from '../channel/Channel.js'
import {CLIChannel, HTTPChannel, ServiceChannel} from '../channel/BuiltinChannels.js'

export type ActionPatternMap = Map<ActionPattern, ActionDetails>

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

type InternalActionPatternMapValue = {
    pattern: ActionPattern
    details: ActionDetails
}

type InternalActionPatternMap = Map<string, InternalActionPatternMapValue>

//The channels of the actions declared by a controller class
const CONTROLLER_CHANNELS: symbol = Symbol('CONTROLLER.CHANNELS')

//The actions of the controllers bound to an entrypoint, by channel
const COMPONENT_CTRL_MAP: symbol = Symbol('COMPONENT.CTRL.MAP')

/**
 * The metadata key of the actions of a channel
 * @param channel
 */
function ChannelActionsKey(channel: string): string {
    return `ENTRYPOINT.CHANNEL.ACTIONS.${channel}`
}

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
 * Get controller's internal action pattern map of a channel
 * @param channel
 * @param target
 * @constructor
 */
function GetInternalControllerActionPatternMap(channel: string, target: IBaseObjectConstructor<Controller>): InternalActionPatternMap {
    const key: string = ChannelActionsKey(channel)
    const internalActionPatternMap: InternalActionPatternMap = new Map()
    ObjectParentConstructors(target).forEach(parentConstructor => {
        const parentActionPatternMap: InternalActionPatternMap = Reflect.getOwnMetadata(key, parentConstructor) || new Map()
        parentActionPatternMap.forEach((value: InternalActionPatternMapValue, hash: string) => internalActionPatternMap.set(hash, value))
    })
    As<InternalActionPatternMap>(Reflect.getOwnMetadata(key, target) || new Map()).forEach((value: InternalActionPatternMapValue, hash: string) => internalActionPatternMap.set(hash, value))
    return internalActionPatternMap
}

/**
 * The channels of the actions of a controller, its parent classes included
 * @param target
 */
export function GetControllerChannels(target: IBaseObjectConstructor<Controller>): string[] {
    const names: Set<string> = new Set()
    for (const constructor of [target, ...ObjectParentConstructors(target)]) {
        const own: Set<string> | undefined = Reflect.getOwnMetadata(CONTROLLER_CHANNELS, constructor)
        own?.forEach((name: string): unknown => names.add(name))
    }
    return [...names]
}

/**
 * Register an action of a controller on a channel
 * @param channel
 * @param target
 * @param actionPattern
 * @param details
 * @constructor
 */
export function RegisterChannelAction(channel: ChannelDefinition, target: IBaseObjectConstructor<Controller>, actionPattern: ActionPattern, details: ActionDetails): void {
    actionPattern = ValidateActionPatternDefinition(channel.validate ? channel.validate(actionPattern) : actionPattern)
    const internalActionPatternMap: InternalActionPatternMap = GetInternalControllerActionPatternMap(channel.name, target)
    internalActionPatternMap.set(ObjectHash(actionPattern), {
        pattern: actionPattern,
        details: {...details, pattern: actionPattern}
    })
    Reflect.defineMetadata(ChannelActionsKey(channel.name), internalActionPatternMap, target)
    const own: Set<string> = Reflect.getOwnMetadata(CONTROLLER_CHANNELS, target) || new Set()
    Reflect.defineMetadata(CONTROLLER_CHANNELS, own.add(channel.name), target)
}

/**
 * Register an action of a controller method on a channel
 * @param channel
 * @param controllerPrototype
 * @param propertyKey
 * @param actionPattern
 * @param dtoConstructor
 * @param actionOptions
 * @constructor
 */
export function RegisterControllerAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    channel: ChannelDefinition,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    actionPattern: ActionPattern,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<any>
): void {
    const constructor: IBaseObjectConstructor<Controller> = As<IBaseObjectConstructor<Controller>>(ObjectConstructor(controllerPrototype))
    const actionInfo: ActionInfo = getActionInfo(controllerPrototype, propertyKey, actionOptions, channel.identify(actionPattern))
    RegisterChannelAction(channel, constructor, actionPattern, {
        ...actionInfo,
        pattern: actionPattern,
        constructor: constructor,
        method: propertyKey,
        dtoConstructor: dtoConstructor,
        jsonSchema: dtoConstructor.toJsonSchema(),
        middlewares: ValidateMiddlewares(actionOptions.middlewares ?? []),
        getActionInfo: () => actionInfo
    })
}

/**
 * Bind controller to component
 * @param component
 * @param controllerConstructor
 * @constructor
 */
export function BindControllerToComponent(component: Component, controllerConstructor: IBaseObjectConstructor<Controller>): void {
    const totalInternalActionPatternMap: Map<string, InternalActionPatternMap> = Reflect.getOwnMetadata(COMPONENT_CTRL_MAP, component) || new Map()
    const prefix: PrefixOptions | undefined = GetPrefix(controllerConstructor)
    //The actions inherited from a parent controller are run by the registered controller
    const bind = (channel: ChannelDefinition, value: InternalActionPatternMapValue): [string, InternalActionPatternMapValue] => {
        const details: ActionDetails = {...value.details, constructor: controllerConstructor}
        const prefixed: ActionPattern | undefined = prefix && channel.prefix ? channel.prefix(prefix, value.pattern) : undefined
        if (prefixed === undefined) return ['', {pattern: value.pattern, details: details}]
        const pattern: ActionPattern = ValidateActionPatternDefinition(channel.validate ? channel.validate(prefixed) : prefixed)
        //A prefixed action is named after the registered controller, so the controllers sharing a parent have distinct actions
        const action: string = `${controllerConstructor.className}:${String(details.method)}`
        details.name = details.name === details.action ? action : details.name
        details.action = action
        details.id = UUID.v5(`${action}:${channel.identify(pattern)}`, UUID.NIL)
        details.pattern = pattern
        const actionInfo: ActionInfo = {id: details.id, acl: details.acl, action: action, name: details.name, description: details.description, groups: details.groups, rule: details.rule}
        details.getActionInfo = (): ActionInfo => actionInfo
        return [ObjectHash(pattern), {pattern: pattern, details: details}]
    }
    for (const name of GetControllerChannels(controllerConstructor)) {
        const channel: ChannelDefinition = GetChannel(name)
        const map: InternalActionPatternMap = totalInternalActionPatternMap.get(name) ?? new Map()
        GetInternalControllerActionPatternMap(name, controllerConstructor).forEach((value: InternalActionPatternMapValue, hash: string): void => {
            const [prefixedHash, bound] = bind(channel, value)
            map.set(prefixedHash || hash, bound)
        })
        totalInternalActionPatternMap.set(name, map)
    }
    Reflect.defineMetadata(COMPONENT_CTRL_MAP, totalInternalActionPatternMap, component)
}

/**
 * Get module controller action map
 * @constructor
 * @param component
 */
export function GetComponentControllerActionMap(component: Component): Map<string, ActionPatternMap> {
    const totalInternalActionPatternMap: Map<string, InternalActionPatternMap> = Reflect.getOwnMetadata(COMPONENT_CTRL_MAP, component) || new Map()
    const totalActionPatternMap: Map<string, ActionPatternMap> = new Map()
    totalInternalActionPatternMap.forEach((map: InternalActionPatternMap, channel: string): void => {
        const actions: ActionPatternMap = new Map()
        map.forEach((value: InternalActionPatternMapValue): unknown => actions.set(value.pattern, value.details))
        totalActionPatternMap.set(channel, actions)
    })
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
    methods.forEach((method: string): void => RegisterControllerAction(HTTPChannel, controllerPrototype, propertyKey, {route: route, method: method}, dtoConstructor, actionOptions))
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
    RegisterControllerAction(CLIChannel, controllerPrototype, propertyKey, {command: command}, dtoConstructor, actionOptions)
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
    RegisterControllerAction(ServiceChannel, controllerPrototype, propertyKey, pattern, dtoConstructor, actionOptions)
}
