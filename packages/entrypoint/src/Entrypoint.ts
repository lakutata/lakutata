import {Component, ActionPattern, Module, JSONSchema, Container, DTO, type BaseObject, type IBaseObjectConstructor} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {CLIContext} from './context/CLIContext.js'
import {HTTPContext} from './context/HTTPContext.js'
import {ServiceContext} from './context/ServiceContext.js'
import {ScheduleContext} from './context/ScheduleContext.js'
import {ActionDetails, ActionPatternMap, BindControllerToComponent, GetComponentControllerActionMap} from './lib/ControllerEntrypoint.js'
import {Controller} from './lib/Controller.js'
import {As, CloneDeep, DevNull} from '@lakutata/utils'
import {GetMethodReturnSchema} from '@lakutata/core/decorator/dto'
import {DuplicateActionNameException} from './exceptions/DuplicateActionNameException.js'
import {AccessControl} from './lib/AccessControl.js'
import {BaseContext, ContextType} from './context/BaseContext.js'
import {AccessControlRule} from './lib/AccessControlRule.js'
import {InvalidActionGroupException} from './exceptions/InvalidActionGroupException.js'
import {
    ActionInvocation,
    ComposeMiddlewares,
    GetClassMiddlewares,
    GetMethodMiddlewares,
    InvocationRunner,
    IsMiddlewareClass,
    Middleware,
    MiddlewareDefinition,
    ValidateMiddlewares
} from './lib/Middleware.js'
import {ChannelDefinition, ChannelEntry, ChannelMatch, ChannelMatcher, DefineChannel, GetChannel, GetChannelByContextType, HasChannel} from './channel/Channel.js'
import {ChannelActionInfo, ChannelRuntime, CommandMap, DispatchOptions, EntrypointAdapter, IsEntrypointAdapter} from './channel/EntrypointAdapter.js'
import {InvalidEntrypointAdapterException} from './exceptions/InvalidEntrypointAdapterException.js'
import {EntrypointStoppedException} from './exceptions/EntrypointStoppedException.js'
import './channel/BuiltinChannels.js'

export {ContextType, BaseContext} from './context/BaseContext.js'
export {CLIContext} from './context/CLIContext.js'
export {HTTPContext} from './context/HTTPContext.js'
export {ServiceContext} from './context/ServiceContext.js'
export {ScheduleContext} from './context/ScheduleContext.js'
export {type HTTPContextParams} from './types/HTTPContextParams.js'
export {type CLIContextParams} from './types/CLIContextParams.js'
export {type ServiceContextParams} from './types/ServiceContextParams.js'
export {type ScheduleContextParams} from './types/ScheduleContextParams.js'

//The builders of the entrypoints of lakutata 2.x: their result is ignored, a promise awaited (an asynchronous builder)
export type CLIEntrypoint = (module: Module, cliMap: CLIMap, handler: CLIEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => unknown
export type HTTPEntrypoint = (module: Module, routeMap: HTTPRouteMap, handler: HTTPEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => unknown
export type ServiceEntrypoint = (module: Module, handler: ServiceEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => unknown

export type CLIMap = Map<string, JSONSchema>
export type HTTPRouteMap<HTTPMethods = string> = Map<string, Set<HTTPMethods>>

export type CLIEntrypointHandler<T = unknown> = (context: CLIContext, abortController?: AbortController) => Promise<T>
export type HTTPEntrypointHandler<T = unknown> = (context: HTTPContext, abortController?: AbortController) => Promise<T>
export type ServiceEntrypointHandler<T = unknown> = (context: ServiceContext, abortController?: AbortController) => Promise<T>

export type EntrypointDestroyer = () => void | Promise<void>
export type EntrypointDestroyerRegistrar = (destroyer: EntrypointDestroyer) => void

/**
 * The entrypoint options, the packages of the other channels add their adapter keys (declaration merging)
 */
export interface EntrypointOptions {
    controllers: IBaseObjectConstructor<Controller>[]
    middlewares?: MiddlewareDefinition[]
    rules?: IBaseObjectConstructor<AccessControlRule>[]
    /**
     * ms, the time given to the requests in progress when the entrypoint stops, they are aborted after it
     */
    shutdownTimeout?: number
    cliActionGroups?: Record<string, string>
    cli?: CLIEntrypoint | EntrypointAdapter<CLIContext> | (CLIEntrypoint | EntrypointAdapter<CLIContext>)[]
    httpActionGroups?: Record<string, string>
    http?: HTTPEntrypoint | EntrypointAdapter<HTTPContext> | (HTTPEntrypoint | EntrypointAdapter<HTTPContext>)[]
    serviceActionGroups?: Record<string, string>
    service?: ServiceEntrypoint | EntrypointAdapter<ServiceContext> | (ServiceEntrypoint | EntrypointAdapter<ServiceContext>)[]
    /**
     * The schedule adapter running the actions declared with @Schedule (they do not run without it)
     */
    schedule?: EntrypointAdapter<ScheduleContext> | EntrypointAdapter<ScheduleContext>[]
}

export interface BaseActionInfo {
    readonly id: string
    readonly acl: boolean
    readonly name: string
    readonly description: string
    readonly groups: string[]
    readonly controller: string
    readonly method: string
    readonly jsonSchema: JSONSchema
}

export interface HTTPActionInfo extends BaseActionInfo {
    readonly route: string
}

export interface ServiceActionInfo extends BaseActionInfo {
    readonly pattern: ActionPattern
}

export interface CLIActionInfo extends BaseActionInfo {
    readonly command: string
}

export interface ActionGroupInfo<T extends BaseActionInfo> {
    readonly id: string
    readonly name: string
    actions: T[]
}

export interface EntrypointActions<T extends BaseActionInfo> {
    readonly groups: ActionGroupInfo<T>[]
    readonly actions: T[]
}

/**
 * Build cli entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildCLIEntrypoint: (entrypoint: CLIEntrypoint) => CLIEntrypoint = (entrypoint: CLIEntrypoint): CLIEntrypoint => entrypoint

/**
 * Build http entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildHTTPEntrypoint: (entrypoint: HTTPEntrypoint) => HTTPEntrypoint = (entrypoint: HTTPEntrypoint): HTTPEntrypoint => entrypoint

/**
 * Build service entrypoint
 * @param entrypoint
 * @constructor
 */
export const BuildServiceEntrypoint: (entrypoint: ServiceEntrypoint) => ServiceEntrypoint = (entrypoint: ServiceEntrypoint): ServiceEntrypoint => entrypoint

/**
 * Build entrypoints options for Entrypoint component
 * @param options
 * @constructor
 */
export const BuildEntrypoints: (options: EntrypointOptions) => EntrypointOptions = (options: EntrypointOptions): EntrypointOptions => options

/**
 * A dispatchable action: its details, its information and its middlewares (controller, options, method)
 */
type ActionEntry = ChannelEntry & {
    readonly middlewares: MiddlewareDefinition[]
    readonly address: ChannelActionInfo
}

/**
 * The actions of a channel
 */
type ChannelState = {
    readonly definition: ChannelDefinition
    readonly entries: ActionEntry[]
    //The action information by id (the entries of an action declared for several addresses share it)
    readonly infos: Map<string, BaseActionInfo & Record<string, unknown>>
    readonly matcher: ChannelMatcher
}

/**
 * A request in progress
 */
type InflightRequest = {
    readonly abortController: AbortController
    promise?: Promise<unknown>
}

/**
 * The promises of the requests in progress (a request is in progress before its promise is created)
 * @param requests
 */
function Promises(requests: Iterable<InflightRequest>): Promise<unknown>[] {
    return [...requests].map((request: InflightRequest): Promise<unknown> | undefined => request.promise).filter((promise: Promise<unknown> | undefined): promise is Promise<unknown> => !!promise)
}

/**
 * A started adapter
 */
type StartedAdapter = {
    readonly adapter: EntrypointAdapter<any>
    readonly inflight: Set<InflightRequest>
}

//The settlement of an aborted request
const ABORTED: unique symbol = Symbol('ABORTED')

//The options of the entrypoint which are not adapters
const ENTRYPOINT_OPTIONS: Set<string> = new Set(['class', 'id', 'controllers', 'middlewares', 'rules', 'shutdownTimeout', 'cliActionGroups', 'httpActionGroups', 'serviceActionGroups'])

//The channels accepting the callbacks of 2.x
const LEGACY_CHANNELS: Set<string> = new Set(['cli', 'http', 'service'])

/**
 * Entrypoint Component
 */
@Singleton()
export class Entrypoint extends Component {

    /**
     * The options of the channels (not configurable properties): the adapters, and the callbacks of 2.x
     * @param name
     * @param value
     */
    public static acceptsOption(name: string, value: unknown): boolean {
        const items: unknown[] = Array.isArray(value) ? value : [value]
        return items.every((item: unknown): boolean => IsEntrypointAdapter(item) || (typeof item === 'function' && LEGACY_CHANNELS.has(name)))
    }

    protected readonly accessControl: typeof AccessControl = AccessControl

    /**
     * Controllers
     * @protected
     */
    @Configurable(DTO.Array(DTO.Class(Controller)).optional().default([]))
    protected readonly controllers: IBaseObjectConstructor<Controller>[]

    /**
     * Middlewares of all the actions
     * @protected
     */
    @Configurable(DTO.Array(DTO.Function()).optional().default([]))
    protected readonly middlewares: MiddlewareDefinition[]

    /**
     * Access control rules
     * @protected
     */
    @Configurable(DTO.Array(DTO.Class(AccessControlRule)).optional().default([]))
    protected readonly rules: IBaseObjectConstructor<AccessControlRule>[]

    /**
     * ms, the time given to the requests in progress when the entrypoint stops
     * @protected
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(30000))
    protected readonly shutdownTimeout: number

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly cliActionGroups: Record<string, string>

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly httpActionGroups: Record<string, string>

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly serviceActionGroups: Record<string, string>

    @Configurable()
    protected readonly cli?: CLIEntrypoint | EntrypointAdapter | (CLIEntrypoint | EntrypointAdapter)[]

    @Configurable()
    protected readonly http?: HTTPEntrypoint | EntrypointAdapter | (HTTPEntrypoint | EntrypointAdapter)[]

    @Configurable()
    protected readonly service?: ServiceEntrypoint | EntrypointAdapter | (ServiceEntrypoint | EntrypointAdapter)[]

    #channels: Map<string, ChannelState> = new Map()

    #started: StartedAdapter[] = []

    #stopping?: Promise<void>

    #resolveReady: () => void = (): void => undefined

    /**
     * Resolved once the adapters started and the application launched
     */
    #ready: Promise<void> = new Promise((resolve: () => void): void => {
        this.#resolveReady = resolve
    })

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        ValidateMiddlewares(this.middlewares)
        const adapters: EntrypointAdapter<any>[] = this.configuredAdapters()
        await Promise.all(this.controllers.map((controllerConstructor: IBaseObjectConstructor<Controller>): Promise<void> => {
            BindControllerToComponent(this, controllerConstructor)
            return this.container.register(controllerConstructor)
        }))
        GetComponentControllerActionMap(this).forEach((actions: ActionPatternMap, channel: string): unknown => this.#channels.set(channel, this.createChannelState(GetChannel(channel), actions)))
        this.checkActions('CLI', this.#channels.get('cli')?.infos, this.cliActionGroups, 'cliActionGroups')
        this.checkActions('HTTP', this.#channels.get('http')?.infos, this.httpActionGroups, 'httpActionGroups')
        this.checkActions('Service', this.#channels.get('service')?.infos, this.serviceActionGroups, 'serviceActionGroups')
        for (const [name, state] of this.#channels) if (!LEGACY_CHANNELS.has(name)) this.checkActions(name, state.infos)
        //The middleware classes are created in the container of each request
        const middlewareClasses: Set<IBaseObjectConstructor<Middleware>> = new Set()
        const addMiddlewareClasses = (middlewares: MiddlewareDefinition[]): void => middlewares.filter(IsMiddlewareClass).forEach((middlewareClass: IBaseObjectConstructor<Middleware>): unknown => middlewareClasses.add(middlewareClass))
        addMiddlewareClasses(this.middlewares)
        this.#channels.forEach((state: ChannelState): void => state.entries.forEach((entry: ActionEntry): void => addMiddlewareClasses(entry.middlewares)))
        adapters.forEach((adapter: EntrypointAdapter<any>): void => addMiddlewareClasses(ValidateMiddlewares(adapter.middlewares ?? [])))
        await Promise.all([...middlewareClasses].map((middlewareClass: IBaseObjectConstructor<Middleware>): Promise<void> => this.container.register(middlewareClass)))
        for (const adapter of adapters) await this.startAdapter(adapter)
    }

    /**
     * The entrypoint is ready once the application has launched (once its adapters started without application, in a
     * bare container)
     * @protected
     */
    protected async launched(): Promise<void> {
        this.#resolveReady()
    }

    /**
     * Stop the adapters (in reverse order) and wait for their requests in progress, before the scopes of the requests
     * in progress and the controllers are destroyed
     * @protected
     */
    protected async beforeDestroy(): Promise<void> {
        await this.stopAdapters()
    }

    /**
     * Stop the adapters (in reverse order) and wait for their requests in progress, once
     * @protected
     */
    protected stopAdapters(): Promise<void> {
        this.#stopping ??= (async (): Promise<void> => {
            const errors: unknown[] = []
            for (const started of [...this.#started].reverse()) {
                try {
                    await started.adapter.stop?.()
                } catch (e) {
                    errors.push(e)
                }
                await this.drain(started)
                try {
                    await started.adapter.close?.()
                } catch (e) {
                    errors.push(e)
                }
            }
            this.#started = []
            if (errors.length === 1) throw errors[0]
            if (errors.length) throw new AggregateError(errors, 'Failed to stop the entrypoint adapters')
        })()
        return this.#stopping
    }

    /**
     * The adapters of the options: every option which is not an entrypoint option is a channel
     * @protected
     */
    protected configuredAdapters(): EntrypointAdapter<any>[] {
        const records: Record<string, unknown> = this.getConfigurableRecords()
        const adapters: EntrypointAdapter<any>[] = []
        for (const [key, value] of Object.entries(records)) {
            if (ENTRYPOINT_OPTIONS.has(key) || value === undefined || value === null) continue
            for (const item of Array.isArray(value) ? value : [value]) {
                if (typeof item === 'function' && LEGACY_CHANNELS.has(key)) {
                    adapters.push(this.legacyAdapter(key, item))
                } else if (IsEntrypointAdapter(item)) {
                    if (item.channel !== key) throw new InvalidEntrypointAdapterException('The option "{key}" is given an adapter of the channel "{channel}"', {key: key, channel: item.channel})
                    if (item.definition) DefineChannel(item.definition)
                    if (!HasChannel(key)) throw new InvalidEntrypointAdapterException('The channel "{key}" of an adapter is not defined', {key: key})
                    adapters.push(item)
                } else {
                    throw new InvalidEntrypointAdapterException('The option "{key}" is not an entrypoint option nor an adapter', {key: key})
                }
            }
        }
        return adapters
    }

    /**
     * The adapter of a callback of 2.x
     * @param channel
     * @param callback
     * @protected
     */
    protected legacyAdapter(channel: string, callback: Function): EntrypointAdapter<any> {
        const destroyers: EntrypointDestroyer[] = []
        const registerDestroy: EntrypointDestroyerRegistrar = (destroyer: EntrypointDestroyer): unknown => destroyers.push(destroyer)
        return {
            channel: channel,
            //An asynchronous builder (async (module, routeMap, handler) => …) is awaited
            start: (runtime: ChannelRuntime<any>): void | Promise<void> => {
                const handler = (context: BaseContext, abortController?: AbortController): Promise<unknown> => runtime.dispatch(context, {signal: abortController?.signal})
                switch (channel) {
                    case 'http': {
                        const routeMap: HTTPRouteMap = new Map()
                        for (const action of runtime.actions) {
                            const methods: Set<string> = routeMap.get(action.address.route) ?? new Set()
                            routeMap.set(action.address.route, methods.add(action.address.method))
                        }
                        return callback(runtime.module, routeMap, handler, registerDestroy)
                    }
                    case 'cli':
                        return callback(runtime.module, CommandMap(runtime.actions), handler, registerDestroy)
                    default:
                        return callback(runtime.module, handler, registerDestroy)
                }
            },
            stop: async (): Promise<void> => void await Promise.all(destroyers.map((destroyer: EntrypointDestroyer): Promise<void> => Promise.resolve(destroyer())))
        }
    }

    /**
     * Collect the actions of a channel
     * @param definition
     * @param actions
     * @protected
     */
    protected createChannelState(definition: ChannelDefinition, actions: ActionPatternMap): ChannelState {
        const entries: ActionEntry[] = []
        const infos: Map<string, BaseActionInfo & Record<string, unknown>> = new Map()
        actions.forEach((details: ActionDetails): void => {
            const info: BaseActionInfo & Record<string, unknown> = {
                id: details.id,
                acl: details.acl,
                name: details.name,
                description: details.description,
                groups: details.groups,
                controller: details.constructor.className,
                method: details.method.toString(),
                jsonSchema: details.jsonSchema,
                ...definition.describe(details.pattern)
            }
            infos.set(details.id, info)
            entries.push({
                details: details,
                info: info,
                address: {...info, address: details.pattern, dto: details.dtoConstructor, returnSchema: GetMethodReturnSchema(details.constructor.prototype, As<string | symbol>(details.method))},
                middlewares: [
                    ...GetClassMiddlewares(details.constructor),
                    ...details.middlewares,
                    ...GetMethodMiddlewares(details.constructor, As<string | symbol>(details.method))
                ]
            })
        })
        return {definition: definition, entries: entries, infos: infos, matcher: definition.createMatcher(entries)}
    }

    /**
     * Check the action groups and names of a channel
     * @param type
     * @param actionInfoMap
     * @param actionGroups
     * @param option
     * @protected
     */
    protected checkActions(type: string, actionInfoMap: Map<string, BaseActionInfo> | undefined, actionGroups?: Record<string, string>, option?: string): void {
        if (!actionInfoMap) return
        if (actionGroups) {
            const invalidGroupIds: string[] = this.findInvalidActionGroupIds(actionInfoMap, actionGroups)
            if (invalidGroupIds.length) throw new InvalidActionGroupException('Found {type} action groups are not defined in {option}: {groupIds}', {
                type: type,
                option: option,
                groupIds: invalidGroupIds
            })
        }
        const duplicateNames: string[] = this.findDuplicateActionNames(actionInfoMap)
        if (duplicateNames.length) throw new DuplicateActionNameException('Duplicate {type} action names found: {names}', {
            type: type,
            names: duplicateNames
        })
    }

    /**
     * Start an adapter
     * @param adapter
     * @protected
     */
    protected async startAdapter(adapter: EntrypointAdapter<any>): Promise<void> {
        const definition: ChannelDefinition = GetChannel(adapter.channel)
        let state: ChannelState | undefined = this.#channels.get(definition.name)
        if (!state) {
            state = this.createChannelState(definition, new Map())
            this.#channels.set(definition.name, state)
        }
        const started: StartedAdapter = {adapter: adapter, inflight: new Set()}
        const channelState: ChannelState = state
        const runners: Map<ActionEntry, InvocationRunner> = new Map()
        const outerMiddlewares: MiddlewareDefinition[] = [...this.middlewares, ...(adapter.middlewares ?? [])]
        const runnerOf = (entry: ActionEntry): InvocationRunner => {
            let runner: InvocationRunner | undefined = runners.get(entry)
            if (!runner) {
                runner = ComposeMiddlewares([...outerMiddlewares, ...entry.middlewares], (invocation: ActionInvocation): Promise<unknown> => this.runAction(entry.details, invocation))
                runners.set(entry, runner)
            }
            return runner
        }
        const entriesByAddress: Map<ChannelActionInfo, ActionEntry> = new Map(channelState.entries.map((entry: ActionEntry): [ChannelActionInfo, ActionEntry] => [entry.address, entry]))
        const runtime: ChannelRuntime<any> = {
            channel: definition,
            module: this.getModule(),
            actions: channelState.entries.map((entry: ActionEntry): ChannelActionInfo => entry.address),
            ready: this.#ready,
            controllers: [...this.controllers],
            getObject: <T extends BaseObject>(target: string | symbol | IBaseObjectConstructor<T>): Promise<T> => this.getObject<T>(target as any),
            dispatch: async (context: BaseContext, options: DispatchOptions = {}): Promise<unknown> => {
                const match: ChannelMatch | undefined = channelState.matcher.match(context)
                if (!match) throw definition.notFound(context)
                const entry: ActionEntry = As<ActionEntry>(match.entry)
                definition.prepare?.(entry, context)
                return this.dispatch(started, entry, runnerOf(entry), context, {...options, params: {...match.params, ...options.params}})
            },
            dispatchTo: async (action: ChannelActionInfo, context: BaseContext, options: DispatchOptions = {}): Promise<unknown> => {
                const entry: ActionEntry | undefined = entriesByAddress.get(action)
                if (!entry) throw definition.notFound(context)
                return this.dispatch(started, entry, runnerOf(entry), context, options)
            }
        }
        await adapter.start(runtime)
        this.#started.push(started)
    }

    /**
     * Wait for the requests in progress of a stopped adapter, abort them after the shutdown timeout
     * @param started
     * @protected
     */
    protected async drain(started: StartedAdapter): Promise<void> {
        if (!started.inflight.size) return
        let timer: NodeJS.Timeout | undefined
        const timeout: Promise<void> = new Promise((resolve: () => void): void => {
            timer = setTimeout(resolve, this.shutdownTimeout)
        })
        await Promise.race([Promise.allSettled(Promises(started.inflight)), timeout])
        clearTimeout(timer)
        const pending: InflightRequest[] = [...started.inflight]
        pending.forEach((request: InflightRequest): void => request.abortController.abort(new EntrypointStoppedException('The entrypoint stopped before the request completed')))
        //The aborted requests settle at once
        await Promise.allSettled(Promises(pending))
    }

    /**
     * Run an action in the container of its request: create the controller, validate the input, check the access and call the action
     * @param details
     * @param invocation
     * @protected
     */
    protected async runAction(details: ActionDetails, invocation: ActionInvocation): Promise<unknown> {
        const {context, container, params} = invocation
        //The controller of the request, shared by the objects of the request
        const controller: Controller = await container.getShared(details.constructor, {context: context})
        //The parameters of the address take precedence over the data of the request
        const data: Record<string, any> = params && Object.keys(params).length ? {...context.data, ...params} : context.data
        //The input is detached from the context, whose values are proxies validating their changes
        const input: Record<string, any> = CloneDeep(await this.validateInput(details.dtoConstructor, data, context.locale))
        await this.runAccessControl(this.rules, container, As(context), input, details)
        return await controller.getMethod(As(details.method))(input)
    }

    /**
     * Validate the input of an action; an invalid input of a request with its language is validated again in it, its
     * error in the language (a valid input is validated once, the settings of its validation unchanged)
     * @param dtoConstructor
     * @param data
     * @param locale
     * @protected
     */
    protected async validateInput(dtoConstructor: typeof DTO, data: Record<string, any>, locale?: string): Promise<Record<string, any>> {
        try {
            return await dtoConstructor.validateAsync(data)
        } catch (error) {
            if (!locale) throw error
            return await dtoConstructor.validateAsync(data, {errors: {language: locale}})
        }
    }

    /**
     * Dispatch a request to an action, in a new request container
     * @param started
     * @param entry
     * @param runner
     * @param context
     * @param options
     * @protected
     */
    protected async dispatch(started: StartedAdapter, entry: ActionEntry, runner: InvocationRunner, context: BaseContext, options: DispatchOptions): Promise<unknown> {
        //An already aborted request is not executed at all
        if (options.signal?.aborted) return
        const request: InflightRequest = {abortController: new AbortController()}
        const abortRequest: () => void = (): void => request.abortController.abort()
        options.signal?.addEventListener('abort', abortRequest, {once: true})
        started.inflight.add(request)
        try {
            request.promise = this.execute(entry, runner, context, request.abortController.signal, options.params)
            return await request.promise
        } finally {
            options.signal?.removeEventListener('abort', abortRequest)
            started.inflight.delete(request)
        }
    }

    /**
     * Execute a request in a new request container, an aborted request destroys its container and its result is dropped
     * @param entry
     * @param runner
     * @param context
     * @param signal
     * @param params
     * @protected
     */
    protected async execute(entry: ActionEntry, runner: InvocationRunner, context: BaseContext, signal: AbortSignal, params?: Record<string, unknown>): Promise<unknown> {
        const runtimeContainer: Container = this.createScope()
        let isAborted: boolean = false
        let settleAborted: () => void = DevNull
        const aborted: Promise<typeof ABORTED> = new Promise((resolve: (value: typeof ABORTED) => void): void => {
            settleAborted = (): void => resolve(ABORTED)
        })
        //Aborting destroys the request scope right away (container destruction is idempotent) and settles the request
        const abortHandler: () => void = (): void => {
            isAborted = true
            runtimeContainer.destroy().catch(DevNull)
            settleAborted()
        }
        signal.addEventListener('abort', abortHandler, {once: true})
        try {
            const running: Promise<unknown> = runner({
                context: As(context),
                action: As(entry.info),
                container: runtimeContainer,
                signal: signal,
                params: params
            })
            //The action of an aborted request may still fail, its error is dropped
            running.catch(DevNull)
            const result: unknown = await Promise.race([running, aborted])
            if (!isAborted) return result
        } catch (e) {
            if (!isAborted) throw e
        } finally {
            //The request scope is always destroyed once the dispatch ends, its destruction never rejects
            signal.removeEventListener('abort', abortHandler)
            runtimeContainer.destroy().catch(DevNull)
        }
        //A request aborted by the stop of the entrypoint fails, a request aborted by its client has no result
        if (signal.reason instanceof EntrypointStoppedException) throw signal.reason
        return undefined
    }

    /**
     * The action information of a channel
     * @param channel
     * @protected
     */
    protected actionInfos<T extends BaseActionInfo>(channel: string): T[] {
        return As<T[]>([...(this.#channels.get(channel)?.infos.values() ?? [])])
    }

    protected get HTTP_ACTIONS(): HTTPActionInfo[] {
        return this.actionInfos('http')
    }

    protected get SERVICE_ACTIONS(): ServiceActionInfo[] {
        return this.actionInfos('service')
    }

    protected get CLI_ACTIONS(): CLIActionInfo[] {
        return this.actionInfos('cli')
    }

    /**
     * The actions of a channel, with their groups
     * @param channel
     * @param actionGroups
     * @protected
     */
    protected getEntrypointActions<T extends BaseActionInfo>(channel: string, actionGroups: Record<string, string> = {}): EntrypointActions<T> {
        const groupMap: Map<string, ActionGroupInfo<T>> = new Map()
        const actions: T[] = this.actionInfos<T>(channel)
        actions.forEach((action: T): void => {
            action.groups.forEach((groupId: string): void => {
                if (!groupMap.has(groupId)) groupMap.set(groupId, {
                    id: groupId,
                    name: actionGroups[groupId],
                    actions: []
                })
                groupMap.get(groupId)?.actions.push(action)
            })
        })
        return {
            groups: [...groupMap.values()],
            actions: actions
        }
    }

    /**
     * The groups of the actions which are not defined
     * @param actionInfoMap
     * @param actionGroups
     * @protected
     */
    protected findInvalidActionGroupIds(actionInfoMap: Map<string, BaseActionInfo>, actionGroups: Record<string, string>): string[] {
        const notfoundGroupIdSet: Set<string> = new Set()
        actionInfoMap.forEach((action: BaseActionInfo): void => action.groups.forEach((groupId: string): void => {
            if (actionGroups[groupId] === undefined) notfoundGroupIdSet.add(groupId)
        }))
        return [...notfoundGroupIdSet]
    }

    /**
     * The duplicate names of the actions
     * @param actionInfoMap
     * @protected
     */
    protected findDuplicateActionNames(actionInfoMap: Map<string, BaseActionInfo>): string[] {
        const seen: Set<string> = new Set()
        const duplicates: Set<string> = new Set()
        actionInfoMap.forEach((action: BaseActionInfo): unknown => seen.has(action.name) ? duplicates.add(action.name) : seen.add(action.name))
        return [...duplicates]
    }

    /**
     * Check the access to an action
     * @param rules
     * @param runtimeContainer
     * @param context
     * @param input
     * @param details
     * @protected
     */
    protected async runAccessControl(rules: IBaseObjectConstructor<AccessControlRule>[], runtimeContainer: Container, context: CLIContext | HTTPContext | ServiceContext, input: Record<string, any>, details: ActionDetails): Promise<void> {
        const [allowed, exception] = await this.accessControl.run(rules, runtimeContainer, context, input, details, (type: ContextType | string): BaseActionInfo[] => {
            const channel: ChannelDefinition | undefined = GetChannelByContextType(type)
            return channel ? this.actionInfos(channel.name) : []
        })
        if (!allowed) throw exception
    }

    /**
     * Push an event to a client of the adapters which have clients (the renderer of a window of Electron, a socket of
     * socket.io), its arguments given to its listeners: the client of a service action is its context.clientId
     * @param clientId
     * @param event
     * @param args
     * @returns whether a client has it
     */
    public notify(clientId: string, event: string, ...args: unknown[]): boolean {
        let notified: boolean = false
        for (const {adapter} of this.#started) if (adapter.notify?.(clientId, event, args)) notified = true
        return notified
    }

    /**
     * Push an event to every client of the adapters which have clients
     * @param event
     * @param args
     * @returns the number of the clients
     */
    public broadcast(event: string, ...args: unknown[]): number {
        let clients: number = 0
        for (const {adapter} of this.#started) clients += adapter.broadcast?.(event, args) ?? 0
        return clients
    }

    public getHttpActionGroups(): Record<string, string> {
        return this.httpActionGroups
    }

    public getServiceActionGroups(): Record<string, string> {
        return this.serviceActionGroups
    }

    public getCliActionGroups(): Record<string, string> {
        return this.cliActionGroups
    }

    public getHttpActions(): EntrypointActions<HTTPActionInfo> {
        return this.getEntrypointActions('http', this.httpActionGroups)
    }

    public getServiceActions(): EntrypointActions<ServiceActionInfo> {
        return this.getEntrypointActions('service', this.serviceActionGroups)
    }

    public getCliActions(): EntrypointActions<CLIActionInfo> {
        return this.getEntrypointActions('cli', this.cliActionGroups)
    }

    /**
     * The actions of a channel
     * @param channel
     */
    public getActions<T extends BaseActionInfo = BaseActionInfo & Record<string, unknown>>(channel: string): EntrypointActions<T> {
        return this.getEntrypointActions<T>(channel)
    }
}
