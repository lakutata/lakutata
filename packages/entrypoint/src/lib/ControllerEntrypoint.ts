import {Controller, type ControllerProperty} from './Controller.js'
import {objectConstructor, As, objectParentConstructors, objectHash, getObjectNestingDepth, UUID} from '@lakutata/utils'
import {IBaseObjectConstructor, ActionPattern, JSONSchema, InvalidActionPatternDepthException, DTO, Component} from '@lakutata/core'
import {ActionOptions} from './ActionOptions.js'
import {CLIContext} from '../context/CLIContext.js'
import {ServiceContext} from '../context/ServiceContext.js'
import {HTTPContext} from '../context/HTTPContext.js'
import type {AccessControlRuleHandler} from './AccessControlRule.js'
import {MiddlewareDefinition, validateMiddlewares} from './Middleware.js'
import {getPrefix, PrefixOptions} from './Prefix.js'
import {ChannelDefinition, getChannel} from '../channel/Channel.js'
import {CLIChannel, HTTPChannel, ServiceChannel} from '../channel/BuiltinChannels.js'

export type ActionPatternMap = Map<ActionPattern, ActionDetails>

/**
 * A registered controller action: its address in its channel, its controller and method, its input DTO and its
 * options. The channels read it from {@link ChannelEntry.details}.
 */
export type ActionDetails<ClassPrototype extends Controller = Controller, DTOConstructor extends typeof DTO = typeof DTO> =
    {
        /**
         * The action's address in its channel (`{route, method}`, `{command}`, a service pattern…), with its
         * controller prefix once bound to an entrypoint.
         */
        pattern: ActionPattern
        /**
         * The controller class serving the action: the registered controller, which may be a subclass of the class
         * declaring the action.
         */
        constructor: IBaseObjectConstructor<ClassPrototype>
        /**
         * The controller method running the action.
         */
        method: string | number | symbol
        /**
         * The DTO validating the action's input.
         */
        dtoConstructor: DTOConstructor
        /**
         * The JSON schema of the action's input (its DTO).
         */
        jsonSchema: JSONSchema
        /**
         * The middlewares of the action's `middlewares` option.
         */
        middlewares: MiddlewareDefinition[]
        /**
         * Get the action's options and identity, as given to the access control rules (`targetAction`).
         * @returns The action's identity and options.
         */
        getActionInfo: () => ActionInfo
    }
    & ActionInfo

/**
 * A controller action's identity and options.
 */
export type ActionInfo = {
    /**
     * The action's id: a UUID derived from the controller, the method and the address, stable across restarts.
     */
    id: string
    /**
     * Whether the action is checked by the access control rules (its `acl` option).
     */
    acl: boolean
    /**
     * The action's controller class and method, as `ControllerClass:method`.
     */
    action: string
    /**
     * The action's name: its `name` option, `ControllerClass:method` by default.
     */
    name: string
    /**
     * The action's description: its `description` option, empty by default.
     */
    description: string
    /**
     * The ids of the action's groups (its `groups` option).
     */
    groups: string[]
    /**
     * The action's own access rule (its `rule` option).
     */
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
function channelActionsKey(channel: string): string {
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
    const action: string = `${As<IBaseObjectConstructor<Controller>>(objectConstructor(controllerPrototype)).className}:${String(propertyKey)}`
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
function validateActionPatternDefinition(actionPattern: ActionPattern): ActionPattern {
    const depth: number = getObjectNestingDepth(actionPattern)
    if (depth > 2) throw new InvalidActionPatternDepthException('The maximum nesting depth of ActionPattern objects cannot be greater than 2 levels. The current nesting depth of the object is {0} levels', [depth])
    return actionPattern
}

/**
 * Get controller's internal action pattern map of a channel
 * @param channel
 * @param target
 * @constructor
 */
function getInternalControllerActionPatternMap(channel: string, target: IBaseObjectConstructor<Controller>): InternalActionPatternMap {
    const key: string = channelActionsKey(channel)
    const internalActionPatternMap: InternalActionPatternMap = new Map()
    //From the farthest parent: the closest declaration of an action wins
    objectParentConstructors(target).reverse().forEach(parentConstructor => {
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
export function getControllerChannels(target: IBaseObjectConstructor<Controller>): string[] {
    const names: Set<string> = new Set()
    for (const constructor of [target, ...objectParentConstructors(target)]) {
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
export function registerChannelAction(channel: ChannelDefinition, target: IBaseObjectConstructor<Controller>, actionPattern: ActionPattern, details: ActionDetails): void {
    actionPattern = validateActionPatternDefinition(channel.validate ? channel.validate(actionPattern) : actionPattern)
    const internalActionPatternMap: InternalActionPatternMap = getInternalControllerActionPatternMap(channel.name, target)
    internalActionPatternMap.set(objectHash(actionPattern), {
        pattern: actionPattern,
        details: {...details, pattern: actionPattern}
    })
    Reflect.defineMetadata(channelActionsKey(channel.name), internalActionPatternMap, target)
    const own: Set<string> = Reflect.getOwnMetadata(CONTROLLER_CHANNELS, target) || new Set()
    Reflect.defineMetadata(CONTROLLER_CHANNELS, own.add(channel.name), target)
}

/**
 * Register a controller method as an action of a channel, for the decorators of the packages providing a channel
 * (the built-in `@HTTPAction`, `@CLIAction` and `@ServiceAction` call it). The action is served by the controller class
 * and its subclasses registered in an entrypoint. Registering the same address again for the class replaces the
 * previous action.
 * @param channel The channel's definition (see {@link defineChannel}).
 * @param controllerPrototype The prototype of the controller class (the decorator's target).
 * @param propertyKey The name of the method running the action.
 * @param actionPattern The action's address, checked by the channel's `validate`; at most 2 levels of nesting.
 * @param dtoConstructor The DTO validating the action's input (`FlexibleDTO` to accept any input).
 * @param actionOptions The action's options (name, description, groups, access control, middlewares); give them
 * validated (as {@link getActionDTOAndOptions} returns them).
 * @throws {InvalidActionPatternDepthException} When the address is nested more than 2 levels deep.
 * @throws {InvalidMiddlewareException} When a middleware of the options is neither a function nor a `Middleware` subclass.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller, type ControllerProperty} from 'lakutata/com/entrypoint'
 * import {getActionDTOAndOptions, getChannel, registerControllerAction, type ActionOptions} from '@lakutata/entrypoint/channel'
 *
 * //A decorator declaring the actions of a "queue" channel defined by its package
 * export function OnMessage(topic: string, dtoOrOptions?: typeof DTO | ActionOptions<any>, options?: ActionOptions<any>) {
 *     return <ClassPrototype extends Controller>(target: ClassPrototype, propertyKey: ControllerProperty<ClassPrototype>): void => {
 *         const [dtoConstructor, actionOptions] = getActionDTOAndOptions(dtoOrOptions, options)
 *         registerControllerAction(getChannel('queue'), target, propertyKey, {topic: topic}, dtoConstructor, actionOptions)
 *     }
 * }
 * ```
 */
export function registerControllerAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    channel: ChannelDefinition,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    actionPattern: ActionPattern,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<any>
): void {
    const constructor: IBaseObjectConstructor<Controller> = As<IBaseObjectConstructor<Controller>>(objectConstructor(controllerPrototype))
    const actionInfo: ActionInfo = getActionInfo(controllerPrototype, propertyKey, actionOptions, channel.identify(actionPattern))
    registerChannelAction(channel, constructor, actionPattern, {
        ...actionInfo,
        pattern: actionPattern,
        constructor: constructor,
        method: propertyKey,
        dtoConstructor: dtoConstructor,
        jsonSchema: dtoConstructor.toJsonSchema(),
        middlewares: validateMiddlewares(actionOptions.middlewares ?? []),
        getActionInfo: () => actionInfo
    })
}

/**
 * Bind controller to component
 * @param component
 * @param controllerConstructor
 * @constructor
 */
export function bindControllerToComponent(component: Component, controllerConstructor: IBaseObjectConstructor<Controller>): void {
    const totalInternalActionPatternMap: Map<string, InternalActionPatternMap> = Reflect.getOwnMetadata(COMPONENT_CTRL_MAP, component) || new Map()
    const prefix: PrefixOptions | undefined = getPrefix(controllerConstructor)
    //The actions inherited from a parent controller are run by the registered controller
    const bind = (channel: ChannelDefinition, value: InternalActionPatternMapValue): [string, InternalActionPatternMapValue] => {
        const details: ActionDetails = {...value.details, constructor: controllerConstructor}
        const prefixed: ActionPattern | undefined = prefix && channel.prefix ? channel.prefix(prefix, value.pattern) : undefined
        if (prefixed === undefined) return ['', {pattern: value.pattern, details: details}]
        const pattern: ActionPattern = validateActionPatternDefinition(channel.validate ? channel.validate(prefixed) : prefixed)
        //A prefixed action is named after the registered controller, so the controllers sharing a parent have distinct actions
        const action: string = `${controllerConstructor.className}:${String(details.method)}`
        details.name = details.name === details.action ? action : details.name
        details.action = action
        details.id = UUID.v5(`${action}:${channel.identify(pattern)}`, UUID.NIL)
        details.pattern = pattern
        const actionInfo: ActionInfo = {id: details.id, acl: details.acl, action: action, name: details.name, description: details.description, groups: details.groups, rule: details.rule}
        details.getActionInfo = (): ActionInfo => actionInfo
        return [objectHash(pattern), {pattern: pattern, details: details}]
    }
    for (const name of getControllerChannels(controllerConstructor)) {
        const channel: ChannelDefinition = getChannel(name)
        const map: InternalActionPatternMap = totalInternalActionPatternMap.get(name) ?? new Map()
        getInternalControllerActionPatternMap(name, controllerConstructor).forEach((value: InternalActionPatternMapValue, hash: string): void => {
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
export function getComponentControllerActionMap(component: Component): Map<string, ActionPatternMap> {
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
export function registerHTTPAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    route: string,
    methods: string[],
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<HTTPContext>
): void {
    methods.forEach((method: string): void => registerControllerAction(HTTPChannel, controllerPrototype, propertyKey, {route: route, method: method}, dtoConstructor, actionOptions))
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
export function registerCLIAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    command: string,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<CLIContext>
): void {
    registerControllerAction(CLIChannel, controllerPrototype, propertyKey, {command: command}, dtoConstructor, actionOptions)
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
export function registerServiceAction<ClassPrototype extends Controller, DTOConstructor extends typeof DTO = typeof DTO>(
    pattern: ActionPattern,
    controllerPrototype: ClassPrototype,
    propertyKey: ControllerProperty<ClassPrototype>,
    dtoConstructor: DTOConstructor,
    actionOptions: ActionOptions<ServiceContext>
): void {
    registerControllerAction(ServiceChannel, controllerPrototype, propertyKey, pattern, dtoConstructor, actionOptions)
}
