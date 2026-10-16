import {Component, ActionPattern, Module, JSONSchema, Container, DTO, type BaseObject, type IBaseObjectConstructor} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {CLIContext} from './context/CLIContext.js'
import {HTTPContext} from './context/HTTPContext.js'
import {ServiceContext} from './context/ServiceContext.js'
import {ScheduleContext} from './context/ScheduleContext.js'
import {ActionDetails, ActionPatternMap, bindControllerToComponent, getComponentControllerActionMap} from './lib/ControllerEntrypoint.js'
import {Controller} from './lib/Controller.js'
import {As, cloneDeep, DevNull} from '@lakutata/utils'
import {getMethodReturnSchema} from '@lakutata/core/decorator/dto'
import {DuplicateActionNameException} from './exceptions/DuplicateActionNameException.js'
import {AccessControl} from './lib/AccessControl.js'
import {BaseContext, ContextType} from './context/BaseContext.js'
import {AccessControlRule} from './lib/AccessControlRule.js'
import {InvalidActionGroupException} from './exceptions/InvalidActionGroupException.js'
import {
    ActionInvocation,
    composeMiddlewares,
    getClassMiddlewares,
    getMethodMiddlewares,
    InvocationRunner,
    isMiddlewareClass,
    Middleware,
    MiddlewareDefinition,
    validateMiddlewares
} from './lib/Middleware.js'
import {ChannelDefinition, ChannelEntry, ChannelMatch, ChannelMatcher, defineChannel, getChannel, getChannelByContextType, hasChannel} from './channel/Channel.js'
import {ChannelActionInfo, ChannelRuntime, commandMap, DispatchOptions, EntrypointAdapter, isEntrypointAdapter} from './channel/EntrypointAdapter.js'
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

//The builders of the entrypoints of lakutata 2.x: called in the entrypoint's startup, their promises awaited
/**
 * A CLI entrypoint in the style of lakutata 2.x: a function the entrypoint calls once when it starts (initialized: the
 * objects it gets may inject the entrypoint), which reads the command line and runs its commands through the handler.
 * A promise it returns is awaited, its rejection fails the entrypoint's startup (2.x did not await it). Prefer an
 * adapter (`commanderCLIEntrypoint` of `lakutata/adapter/commander`) for new code.
 * @param module The module owning the entrypoint (the application).
 * @param cliMap The CLI actions' commands, each with the JSON schema of its input.
 * @param handler Runs a command: dispatches a {@link CLIContext} to the matching action.
 * @param registerDestroy Registers a function run when the entrypoint stops.
 */
export type CLIEntrypoint = (module: Module, cliMap: CLIMap, handler: CLIEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => unknown
/**
 * An HTTP entrypoint in the style of lakutata 2.x: a function the entrypoint calls once when it starts (initialized:
 * the objects it gets, such as an authenticator of the requests, may inject the entrypoint), which starts a server and
 * passes its requests to the handler. A promise it returns is awaited, its rejection fails the entrypoint's startup
 * (2.x did not await it). Prefer an adapter (`expressHTTPEntrypoint` of `lakutata/adapter/express`,
 * `fastifyHTTPEntrypoint` of `lakutata/adapter/fastify`) for new code.
 * @param module The module owning the entrypoint (the application).
 * @param routeMap The HTTP actions' routes, each with its methods.
 * @param handler Runs a request: dispatches an {@link HTTPContext} to the matching action.
 * @param registerDestroy Registers a function run when the entrypoint stops (closing the server).
 */
export type HTTPEntrypoint = (module: Module, routeMap: HTTPRouteMap, handler: HTTPEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => unknown
/**
 * A service entrypoint in the style of lakutata 2.x: a function the entrypoint calls once when it starts (initialized:
 * the objects it gets may inject the entrypoint), which receives the service requests of a transport and passes them
 * to the handler. A promise it returns is awaited, its rejection fails the entrypoint's startup (2.x did not await it).
 * Prefer an adapter (`socketIOServiceEntrypoint`, `jsonRPCServiceEntrypoint`, `electronIPCServiceEntrypoint`) for new code.
 * @param module The module owning the entrypoint (the application).
 * @param handler Runs a request: dispatches a {@link ServiceContext} to the action whose pattern matches its input.
 * @param registerDestroy Registers a function run when the entrypoint stops.
 */
export type ServiceEntrypoint = (module: Module, handler: ServiceEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => unknown

/**
 * The CLI actions given to a {@link CLIEntrypoint}: each command mapped to the JSON schema of its input (its DTO).
 */
export type CLIMap = Map<string, JSONSchema>
/**
 * The HTTP actions given to an {@link HTTPEntrypoint}: each route (with its controller prefix) mapped to the set of
 * its HTTP methods, as declared (`get`, `post`… from `@GET`, `@POST`…; `@HTTPAction` keeps the case it is given).
 */
export type HTTPRouteMap<HTTPMethods = string> = Map<string, Set<HTTPMethods>>

/**
 * Dispatch a CLI request to the action of its command, given to a {@link CLIEntrypoint}.
 * The promise resolves to the action's result; it rejects with a `ControllerActionNotFoundException` when no action
 * has the command, and with the error of the input validation, the access control or the action. Aborting the
 * controller cancels the request: its result is dropped and the promise resolves to `undefined`; a request aborted
 * before it starts is not run at all.
 * @param context The request: its command and its data (the input of the action).
 * @param abortController Aborts the request, for example when its client goes away.
 * @returns The action's result.
 */
export type CLIEntrypointHandler<T = unknown> = (context: CLIContext, abortController?: AbortController) => Promise<T>
/**
 * Dispatch an HTTP request to the action of its route and method, given to an {@link HTTPEntrypoint}.
 * The promise resolves to the action's result; it rejects with a `ControllerActionNotFoundException` when no action
 * matches, and with the error of the input validation, the access control or the action. Aborting the controller
 * cancels the request: its result is dropped and the promise resolves to `undefined`; a request aborted before it
 * starts is not run at all.
 * @param context The request: its route, method, data (the input of the action), request and response.
 * @param abortController Aborts the request, for example when its connection closes.
 * @returns The action's result.
 */
export type HTTPEntrypointHandler<T = unknown> = (context: HTTPContext, abortController?: AbortController) => Promise<T>
/**
 * Dispatch a service request to the action whose pattern matches its input, given to a {@link ServiceEntrypoint}.
 * The promise resolves to the action's result; it rejects with a `ControllerActionNotFoundException` when no action
 * matches, and with the error of the input validation, the access control or the action. Aborting the controller
 * cancels the request: its result is dropped and the promise resolves to `undefined`; a request aborted before it
 * starts is not run at all.
 * @param context The request: its data, matched against the actions' patterns (the pattern keys are removed from the
 * action's input).
 * @param abortController Aborts the request, for example when its client disconnects.
 * @returns The action's result.
 */
export type ServiceEntrypointHandler<T = unknown> = (context: ServiceContext, abortController?: AbortController) => Promise<T>

/**
 * A function releasing what a 2.x entrypoint started (a server, a connection), run when the entrypoint stops; the
 * entrypoint then waits for the requests in progress.
 */
export type EntrypointDestroyer = () => void | Promise<void>
/**
 * Register an {@link EntrypointDestroyer}, given to the 2.x entrypoints. The destroyers registered by an entrypoint run
 * together (not in order) when it stops; their failures are thrown from the entrypoint's destruction.
 * @param destroyer The function run when the entrypoint stops.
 */
export type EntrypointDestroyerRegistrar = (destroyer: EntrypointDestroyer) => void

/**
 * The options of the {@link Entrypoint} component: its controllers, middlewares and access rules, and the adapters
 * receiving the requests of each channel. Any other key is the name of a channel and takes that channel's adapters
 * (the packages providing a channel add their key to this interface by declaration merging); an adapter given under
 * another channel's key, or a key which is neither an option nor an adapter, fails the entrypoint's initialization
 * with an `InvalidEntrypointAdapterException`.
 * Build them with {@link buildEntrypoints}.
 */
export interface EntrypointOptions {
    /**
     * The controller classes whose actions the entrypoint serves. They are registered in the entrypoint's container;
     * an action declared in a parent controller is served by each registered subclass.
     */
    controllers: IBaseObjectConstructor<Controller>[]
    /**
     * The middlewares run around every action of every channel, in order, before the ones of the adapter, of the
     * controller class and of the action.
     * @default []
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * The access control rule classes checked for the actions declared with `acl: true`, in order; a rule is skipped
     * for the contexts not in its `supportContextTypes`.
     * @default []
     */
    rules?: IBaseObjectConstructor<AccessControlRule>[]
    /**
     * The time in milliseconds given to the requests in progress when the entrypoint stops; the ones still running
     * after it are aborted, and fail with an `EntrypointStoppedException`.
     * @default 30000
     */
    shutdownTimeout?: number
    /**
     * The CLI action groups: each group id (used in the actions' `groups` option) mapped to its display name. An action
     * in a group not listed here fails the entrypoint's initialization with an `InvalidActionGroupException`.
     * @default {}
     */
    cliActionGroups?: Record<string, string>
    /**
     * The adapters (or 2.x entrypoint functions) receiving the CLI requests, such as `commanderCLIEntrypoint()`.
     */
    cli?: CLIEntrypoint | EntrypointAdapter<CLIContext> | (CLIEntrypoint | EntrypointAdapter<CLIContext>)[]
    /**
     * The HTTP action groups: each group id (used in the actions' `groups` option) mapped to its display name. An
     * action in a group not listed here fails the entrypoint's initialization with an `InvalidActionGroupException`.
     * @default {}
     */
    httpActionGroups?: Record<string, string>
    /**
     * The adapters (or 2.x entrypoint functions) receiving the HTTP requests, such as `expressHTTPEntrypoint()`.
     */
    http?: HTTPEntrypoint | EntrypointAdapter<HTTPContext> | (HTTPEntrypoint | EntrypointAdapter<HTTPContext>)[]
    /**
     * The service action groups: each group id (used in the actions' `groups` option) mapped to its display name. An
     * action in a group not listed here fails the entrypoint's initialization with an `InvalidActionGroupException`.
     * @default {}
     */
    serviceActionGroups?: Record<string, string>
    /**
     * The adapters (or 2.x entrypoint functions) receiving the service requests, such as `socketIOServiceEntrypoint()`.
     */
    service?: ServiceEntrypoint | EntrypointAdapter<ServiceContext> | (ServiceEntrypoint | EntrypointAdapter<ServiceContext>)[]
    /**
     * The schedule adapter running the actions declared with `@Schedule` (`scheduleEntrypoint()`); without it they
     * never run.
     */
    schedule?: EntrypointAdapter<ScheduleContext> | EntrypointAdapter<ScheduleContext>[]
}

/**
 * The description of a controller action in a channel, as listed by {@link Entrypoint.getActions}, given to the
 * access control rules and, extended with the address, to the adapters.
 */
export interface BaseActionInfo {
    /**
     * The action's id: a UUID derived from the controller, the method and the address, stable across restarts.
     */
    readonly id: string
    /**
     * Whether the action is checked by the access control rules (its `acl` option).
     */
    readonly acl: boolean
    /**
     * The action's name: its `name` option, `ControllerClass:method` by default. It is unique within a channel among
     * the controller methods (the addresses of one method share its name).
     */
    readonly name: string
    /**
     * The action's description: its `description` option, empty by default.
     */
    readonly description: string
    /**
     * The ids of the action's groups (its `groups` option).
     */
    readonly groups: string[]
    /**
     * The class name of the controller serving the action.
     */
    readonly controller: string
    /**
     * The name of the controller method running the action.
     */
    readonly method: string
    /**
     * The JSON schema of the action's input (its DTO).
     */
    readonly jsonSchema: JSONSchema
}

/**
 * The description of an HTTP action.
 */
export interface HTTPActionInfo extends BaseActionInfo {
    /**
     * The action's route, with its controller prefix.
     */
    readonly route: string
}

/**
 * The description of a service action.
 */
export interface ServiceActionInfo extends BaseActionInfo {
    /**
     * The pattern the requests' input matches, with its controller prefix.
     */
    readonly pattern: ActionPattern
}

/**
 * The description of a CLI action.
 */
export interface CLIActionInfo extends BaseActionInfo {
    /**
     * The action's command, with its controller prefix.
     */
    readonly command: string
}

/**
 * A group of actions of a channel, as listed by {@link Entrypoint.getActions}.
 */
export interface ActionGroupInfo<T extends BaseActionInfo> {
    /**
     * The group's id, as used in the actions' `groups` option.
     */
    readonly id: string
    /**
     * The group's display name, from the entrypoint's action group options (`httpActionGroups`…); `undefined` for the
     * channels without such an option.
     */
    readonly name: string
    /**
     * The actions in the group.
     */
    actions: T[]
}

/**
 * The actions of a channel, and the groups they belong to.
 */
export interface EntrypointActions<T extends BaseActionInfo> {
    /**
     * The groups used by the actions, each with its actions; an action may be in several groups.
     */
    readonly groups: ActionGroupInfo<T>[]
    /**
     * Every action of the channel, grouped or not.
     */
    readonly actions: T[]
}

/**
 * Type a CLI entrypoint in the style of lakutata 2.x; the function is returned as it is.
 * @param entrypoint The function the entrypoint calls when it starts, with the module, the commands, the request
 * handler and the destroyer registrar.
 * @returns The same function, to give to the `cli` option of {@link buildEntrypoints}.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCLIEntrypoint, buildEntrypoints, CLIContext, Controller} from 'lakutata/com/entrypoint'
 * import {CLIAction} from 'lakutata/decorator/ctrl'
 *
 * class VersionController extends Controller {
 *     @CLIAction('version')
 *     public async version(): Promise<string> {
 *         return '1.0.0'
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'tool.app',
 *     name: 'Tool',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [VersionController],
 *             //Run the command given as the first argument once the entrypoint starts
 *             cli: buildCLIEntrypoint(async (module, cliMap, handler): Promise<void> => {
 *                 const command: string = process.argv[2] ?? 'version'
 *                 if (cliMap.has(command)) console.log(await handler(new CLIContext({command: command, data: {}})))
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export const buildCLIEntrypoint: (entrypoint: CLIEntrypoint) => CLIEntrypoint = (entrypoint: CLIEntrypoint): CLIEntrypoint => entrypoint

/**
 * Type an HTTP entrypoint in the style of lakutata 2.x; the function is returned as it is.
 * @param entrypoint The function the entrypoint calls when it starts, with the module, the routes, the request handler
 * and the destroyer registrar.
 * @returns The same function, to give to the `http` option of {@link buildEntrypoints}.
 * @example
 * ```typescript
 * import {createServer, type Server} from 'node:http'
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, buildHTTPEntrypoint, Controller, HTTPContext} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 *
 * class HealthController extends Controller {
 *     @GET('/health')
 *     public async health(): Promise<{status: string}> {
 *         return {status: 'ok'}
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'api.app',
 *     name: 'API',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [HealthController],
 *             http: buildHTTPEntrypoint((module, routeMap, handler, registerDestroy): void => {
 *                 const server: Server = createServer(async (request, response): Promise<void> => {
 *                     //The route map holds the routes and the methods as declared: '/health', 'get'
 *                     const route: string = (request.url ?? '/').split('?')[0]
 *                     const method: string = (request.method ?? 'GET').toLowerCase()
 *                     if (!routeMap.get(route)?.has(method)) {
 *                         response.writeHead(404).end()
 *                         return
 *                     }
 *                     const abortController: AbortController = new AbortController()
 *                     response.on('close', (): void => abortController.abort())
 *                     try {
 *                         const context: HTTPContext = new HTTPContext({route, method, request, response, data: {}})
 *                         response.end(JSON.stringify(await handler(context, abortController)))
 *                     } catch (error) {
 *                         response.writeHead(500).end((error as Error).message)
 *                     }
 *                 }).listen(3000)
 *                 registerDestroy((): Promise<void> => new Promise((resolve): void => void server.close((): void => resolve())))
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export const buildHTTPEntrypoint: (entrypoint: HTTPEntrypoint) => HTTPEntrypoint = (entrypoint: HTTPEntrypoint): HTTPEntrypoint => entrypoint

/**
 * Type a service entrypoint in the style of lakutata 2.x; the function is returned as it is.
 * @param entrypoint The function the entrypoint calls when it starts, with the module, the request handler and the
 * destroyer registrar.
 * @returns The same function, to give to the `service` option of {@link buildEntrypoints}.
 * @example
 * ```typescript
 * import {EventEmitter} from 'node:events'
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, buildServiceEntrypoint, Controller, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 *
 * declare const bus: EventEmitter
 *
 * class MathController extends Controller {
 *     @ServiceAction({ctrl: 'math', act: 'add'})
 *     public async add(input: {a: number, b: number}): Promise<number> {
 *         return input.a + input.b
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'math.app',
 *     name: 'Math',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [MathController],
 *             //Each message of the bus is a request: its data matched against the patterns of the actions
 *             service: buildServiceEntrypoint((module, handler, registerDestroy): void => {
 *                 const listener = async (data: Record<string, any>, reply: (result: unknown) => void): Promise<void> => {
 *                     reply(await handler(new ServiceContext({data: data})))
 *                 }
 *                 bus.on('request', listener)
 *                 registerDestroy((): void => void bus.off('request', listener))
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export const buildServiceEntrypoint: (entrypoint: ServiceEntrypoint) => ServiceEntrypoint = (entrypoint: ServiceEntrypoint): ServiceEntrypoint => entrypoint

/**
 * Type the options of the {@link Entrypoint} component; they are returned as they are. The applications of the
 * `lakutata` package declare the entrypoint as the component `entrypoint`: give these options to it.
 * @param options The controllers, middlewares, access rules and the adapters of each channel.
 * @returns The same options, to declare as the `entrypoint` component.
 * @example
 * ```typescript
 * import {Application, DTO} from 'lakutata'
 * import {buildEntrypoints, Controller, scheduleEntrypoint} from 'lakutata/com/entrypoint'
 * import {GET, POST, Schedule} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 *
 * class CreateOrderDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public product: string
 * }
 *
 * class OrderController extends Controller {
 *     @GET('/orders', {name: 'listOrders', groups: ['orders']})
 *     public async list(): Promise<string[]> {
 *         return []
 *     }
 *
 *     @POST('/orders', CreateOrderDTO, {name: 'createOrder', groups: ['orders']})
 *     public async create(input: CreateOrderDTO): Promise<{product: string}> {
 *         return {product: input.product}
 *     }
 *
 *     @Schedule('0 * * * *')
 *     public async purge(): Promise<void> {
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [OrderController],
 *             httpActionGroups: {orders: 'Orders'},
 *             shutdownTimeout: 10000,
 *             http: expressHTTPEntrypoint({port: 3000}),
 *             schedule: scheduleEntrypoint()
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export const buildEntrypoints: (options: EntrypointOptions) => EntrypointOptions = (options: EntrypointOptions): EntrypointOptions => options

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
function promises(requests: Iterable<InflightRequest>): Promise<unknown>[] {
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
 * The entrypoint component: it serves the controllers' actions to the requests of every channel (HTTP, CLI, service,
 * schedule, and the channels of other packages), each received by the adapters configured for its channel.
 *
 * The applications of the `lakutata` package declare it as the component `entrypoint`: configure it with
 * {@link buildEntrypoints}. When it initializes, it registers the controllers and checks their actions (their groups and
 * the uniqueness of their names); then, in its startup, it starts the adapters in order (the objects their hooks get may
 * inject the entrypoint; the objects getting the entrypoint wait for its adapters); it is ready (the adapters acting on
 * their own, such as the schedules, begin) once the application has launched. Each request runs in a scope of its own: its middlewares,
 * then a new controller instance receiving its context and signal, the validation of its input, the access control
 * and the action; the scope is destroyed when the request ends.
 *
 * When it is destroyed, it stops the adapters in reverse order: each stops receiving requests, the requests in progress
 * get `shutdownTimeout` milliseconds to complete and are then aborted (failing with an `EntrypointStoppedException`),
 * and the adapter is closed.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {buildEntrypoints, Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
 * import {GET, ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Inject} from 'lakutata/decorator/di'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 *
 * class ChatController extends Controller {
 *     @Inject('entrypoint')
 *     protected readonly entrypoint: Entrypoint
 *
 *     //Served over HTTP: GET /rooms
 *     @GET('/rooms')
 *     public async rooms(): Promise<string[]> {
 *         return ['general']
 *     }
 *
 *     //Served over Socket.IO, the message pushed to every client
 *     @ServiceAction({act: 'say'})
 *     public async say(input: {text: string}): Promise<number> {
 *         const from: string | undefined = (this.context as ServiceContext).clientId
 *         return this.entrypoint.broadcast('message', from, input.text)
 *     }
 * }
 *
 * Application
 *     .run(() => ({
 *         id: 'chat.app',
 *         name: 'Chat',
 *         components: {
 *             entrypoint: buildEntrypoints({
 *                 controllers: [ChatController],
 *                 http: expressHTTPEntrypoint({port: 3000}),
 *                 service: socketIOServiceEntrypoint({port: 3001})
 *             })
 *         },
 *         bootstrap: ['entrypoint']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const entrypoint: Entrypoint = await app.getObject<Entrypoint>('entrypoint')
 *         console.log(entrypoint.getHttpActions().actions.map(action => action.route)) //['/rooms']
 *     })
 * ```
 */
@Singleton()
export class Entrypoint extends Component {

    /**
     * Whether an option which is not a configurable property is accepted: the adapters given under a channel's key,
     * and the 2.x entrypoint functions under `cli`, `http` and `service`. The container calls it when it checks the
     * component's options.
     * @param name The option's key.
     * @param value The option's value: one item or an array.
     * @returns `true` when every item is an adapter, or a function under a 2.x channel's key.
     */
    public static acceptsOption(name: string, value: unknown): boolean {
        const items: unknown[] = Array.isArray(value) ? value : [value]
        return items.every((item: unknown): boolean => isEntrypointAdapter(item) || (typeof item === 'function' && LEGACY_CHANNELS.has(name)))
    }

    /**
     * The class running the access control of the actions declared with `acl: true` or a `rule`; a subclass of the
     * entrypoint may replace it with a subclass of {@link AccessControl}.
     * @protected
     */
    protected readonly accessControl: typeof AccessControl = AccessControl

    /**
     * The controller classes whose actions the entrypoint serves.
     * @default []
     * @protected
     */
    @Configurable(DTO.Array(DTO.Class(Controller)).optional().default([]))
    protected readonly controllers: IBaseObjectConstructor<Controller>[]

    /**
     * The middlewares run around every action of every channel, before the ones of the adapter, of the controller class
     * and of the action.
     * @default []
     * @protected
     */
    @Configurable(DTO.Array(DTO.Function()).optional().default([]))
    protected readonly middlewares: MiddlewareDefinition[]

    /**
     * The access control rule classes checked for the actions declared with `acl: true`.
     * @default []
     * @protected
     */
    @Configurable(DTO.Array(DTO.Class(AccessControlRule)).optional().default([]))
    protected readonly rules: IBaseObjectConstructor<AccessControlRule>[]

    /**
     * The time in milliseconds given to the requests in progress when the entrypoint stops, before they are aborted.
     * @default 30000
     * @protected
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(30000))
    protected readonly shutdownTimeout: number

    /**
     * The CLI action groups: each group id mapped to its display name.
     * @default {}
     * @protected
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly cliActionGroups: Record<string, string>

    /**
     * The HTTP action groups: each group id mapped to its display name.
     * @default {}
     * @protected
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly httpActionGroups: Record<string, string>

    /**
     * The service action groups: each group id mapped to its display name.
     * @default {}
     * @protected
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly serviceActionGroups: Record<string, string>

    /**
     * The adapters (or 2.x entrypoint functions) receiving the CLI requests.
     * @protected
     */
    @Configurable()
    protected readonly cli?: CLIEntrypoint | EntrypointAdapter | (CLIEntrypoint | EntrypointAdapter)[]

    /**
     * The adapters (or 2.x entrypoint functions) receiving the HTTP requests.
     * @protected
     */
    @Configurable()
    protected readonly http?: HTTPEntrypoint | EntrypointAdapter | (HTTPEntrypoint | EntrypointAdapter)[]

    /**
     * The adapters (or 2.x entrypoint functions) receiving the service requests.
     * @protected
     */
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
     * The adapters to start, once the entrypoint is initialized
     */
    #adapters: EntrypointAdapter<any>[] = []

    /**
     * Register the controllers and the middleware classes and check the actions: once initialized, the entrypoint can be
     * got by the other objects (its actions listed by `getHttpActions()`…), the adapters start in {@link startup}.
     * @throws {InvalidMiddlewareException} When a middleware is neither a function nor a {@link Middleware} subclass.
     * @throws {InvalidEntrypointAdapterException} When an option is neither an entrypoint option nor an adapter of its
     * channel.
     * @throws {InvalidActionGroupException} When an action is in a group missing from its channel's action groups.
     * @throws {DuplicateActionNameException} When two actions of a channel have the same name.
     * @protected
     */
    protected async init(): Promise<void> {
        validateMiddlewares(this.middlewares)
        const adapters: EntrypointAdapter<any>[] = this.#adapters = this.configuredAdapters()
        await Promise.all(this.controllers.map((controllerConstructor: IBaseObjectConstructor<Controller>): Promise<void> => {
            bindControllerToComponent(this, controllerConstructor)
            return this.container.register(controllerConstructor)
        }))
        getComponentControllerActionMap(this).forEach((actions: ActionPatternMap, channel: string): unknown => this.#channels.set(channel, this.createChannelState(getChannel(channel), actions)))
        this.checkActions('CLI', this.#channels.get('cli')?.infos, this.cliActionGroups, 'cliActionGroups')
        this.checkActions('HTTP', this.#channels.get('http')?.infos, this.httpActionGroups, 'httpActionGroups')
        this.checkActions('Service', this.#channels.get('service')?.infos, this.serviceActionGroups, 'serviceActionGroups')
        for (const [name, state] of this.#channels) if (!LEGACY_CHANNELS.has(name)) this.checkActions(name, state.infos)
        //The middleware classes are created in the container of each request
        const middlewareClasses: Set<IBaseObjectConstructor<Middleware>> = new Set()
        const addMiddlewareClasses = (middlewares: MiddlewareDefinition[]): void => middlewares.filter(isMiddlewareClass).forEach((middlewareClass: IBaseObjectConstructor<Middleware>): unknown => middlewareClasses.add(middlewareClass))
        addMiddlewareClasses(this.middlewares)
        this.#channels.forEach((state: ChannelState): void => state.entries.forEach((entry: ActionEntry): void => addMiddlewareClasses(entry.middlewares)))
        adapters.forEach((adapter: EntrypointAdapter<any>): void => addMiddlewareClasses(validateMiddlewares(adapter.middlewares ?? [])))
        await Promise.all([...middlewareClasses].map((middlewareClass: IBaseObjectConstructor<Middleware>): Promise<void> => this.container.register(middlewareClass)))
    }

    /**
     * Start the adapters in order, once the entrypoint is initialized: the objects their hooks get (an authenticator of
     * the requests adding its middleware to an HTTP server) may inject the entrypoint. The objects getting the
     * entrypoint wait for the adapters, and fail when one fails to start (a port in use).
     * @protected
     */
    protected async startup(): Promise<void> {
        for (const adapter of this.#adapters) await this.startAdapter(adapter)
    }

    /**
     * Mark the entrypoint ready: the application has launched (in a bare container, once its adapters started).
     * @protected
     */
    protected async launched(): Promise<void> {
        this.#resolveReady()
    }

    /**
     * Stop the adapters, before the scopes of the requests in progress and the controllers are destroyed (see
     * {@link Entrypoint.stopAdapters}).
     * @protected
     */
    protected async beforeDestroy(): Promise<void> {
        await this.stopAdapters()
    }

    /**
     * Stop the adapters in reverse order, once (a second call returns the same promise): each adapter stops receiving
     * requests, its requests in progress get `shutdownTimeout` milliseconds before they are aborted, then it is closed.
     * Every adapter is stopped even when another fails.
     * @returns Resolves once every adapter is closed.
     * @throws {AggregateError} When several adapters failed to stop or close; a single failure is thrown as it is.
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
     * The adapters of the options: every option which is not an entrypoint option is a channel's key; a 2.x entrypoint
     * function is wrapped in an adapter, the channel of an adapter carrying its definition is defined.
     * @returns The adapters, in the order of the options.
     * @throws {InvalidEntrypointAdapterException} When an adapter is given under another channel's key, its channel is
     * not defined, or the option is neither an adapter nor a 2.x function of `cli`, `http` or `service`.
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
                } else if (isEntrypointAdapter(item)) {
                    if (item.channel !== key) throw new InvalidEntrypointAdapterException('The option "{key}" is given an adapter of the channel "{channel}"', {key: key, channel: item.channel})
                    if (item.definition) defineChannel(item.definition)
                    if (!hasChannel(key)) throw new InvalidEntrypointAdapterException('The channel "{key}" of an adapter is not defined', {key: key})
                    adapters.push(item)
                } else {
                    throw new InvalidEntrypointAdapterException('The option "{key}" is not an entrypoint option nor an adapter', {key: key})
                }
            }
        }
        return adapters
    }

    /**
     * Wrap a 2.x entrypoint function in an adapter: it is called when the adapter starts, in the entrypoint's
     * {@link startup} (the entrypoint initialized: the objects it gets may inject the entrypoint, as in 2.x), and the
     * promise of an asynchronous builder is awaited — its failure fails the entrypoint's startup, so the application's
     * launch (2.x did not await it: the application launched without its server, the failure an unhandled rejection).
     * Its registered destroyers run when the adapter stops.
     * @param channel The channel: `cli`, `http` or `service`.
     * @param callback The {@link CLIEntrypoint}, {@link HTTPEntrypoint} or {@link ServiceEntrypoint}.
     * @returns The adapter.
     * @protected
     */
    protected legacyAdapter(channel: string, callback: Function): EntrypointAdapter<any> {
        const destroyers: EntrypointDestroyer[] = []
        const registerDestroy: EntrypointDestroyerRegistrar = (destroyer: EntrypointDestroyer): unknown => destroyers.push(destroyer)
        return {
            channel: channel,
            start: async (runtime: ChannelRuntime<any>): Promise<void> => {
                const handler = (context: BaseContext, abortController?: AbortController): Promise<unknown> => runtime.dispatch(context, {signal: abortController?.signal})
                const run = (): unknown => {
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
                            return callback(runtime.module, commandMap(runtime.actions), handler, registerDestroy)
                        default:
                            return callback(runtime.module, handler, registerDestroy)
                    }
                }
                await run()
            },
            stop: async (): Promise<void> => {
                await Promise.all(destroyers.map((destroyer: EntrypointDestroyer): Promise<void> => Promise.resolve(destroyer())))
            }
        }
    }

    /**
     * Collect the actions of a channel: their descriptions, their middlewares and the channel's lookup.
     * @param definition The channel.
     * @param actions The actions bound to the entrypoint for the channel, by address.
     * @returns The channel's state.
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
                address: {...info, address: details.pattern, dto: details.dtoConstructor, returnSchema: getMethodReturnSchema(details.constructor.prototype, As<string | symbol>(details.method))},
                middlewares: [
                    ...getClassMiddlewares(details.constructor),
                    ...details.middlewares,
                    ...getMethodMiddlewares(details.constructor, As<string | symbol>(details.method))
                ]
            })
        })
        return {definition: definition, entries: entries, infos: infos, matcher: definition.createMatcher(entries)}
    }

    /**
     * Check a channel's actions: their groups are defined (when the channel has action groups) and their names unique.
     * @param type The channel's name used in the error messages (`HTTP`, `CLI`…).
     * @param actionInfoMap The channel's action descriptions by id; nothing is checked when it is `undefined`.
     * @param actionGroups The channel's action groups; the groups are not checked without them.
     * @param option The option holding the action groups, named in the error message.
     * @throws {InvalidActionGroupException} When an action is in a group missing from `actionGroups`.
     * @throws {DuplicateActionNameException} When two actions have the same name.
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
     * Start an adapter, giving it the runtime of its channel (its actions and the dispatch functions).
     * @param adapter The adapter.
     * @throws {InvalidChannelException} When the adapter's channel is not defined.
     * @protected
     */
    protected async startAdapter(adapter: EntrypointAdapter<any>): Promise<void> {
        const definition: ChannelDefinition = getChannel(adapter.channel)
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
                runner = composeMiddlewares([...outerMiddlewares, ...entry.middlewares], (invocation: ActionInvocation): Promise<unknown> => this.runAction(entry.details, invocation))
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
     * Wait for a stopped adapter's requests in progress; abort the ones still running after `shutdownTimeout`
     * milliseconds with an {@link EntrypointStoppedException}.
     * @param started The adapter and its requests in progress.
     * @protected
     */
    protected async drain(started: StartedAdapter): Promise<void> {
        if (!started.inflight.size) return
        let timer: NodeJS.Timeout | undefined
        const timeout: Promise<void> = new Promise((resolve: () => void): void => {
            timer = setTimeout(resolve, this.shutdownTimeout)
        })
        await Promise.race([Promise.allSettled(promises(started.inflight)), timeout])
        clearTimeout(timer)
        const pending: InflightRequest[] = [...started.inflight]
        pending.forEach((request: InflightRequest): void => request.abortController.abort(new EntrypointStoppedException('The entrypoint stopped before the request completed')))
        //The aborted requests settle at once
        await Promise.allSettled(promises(pending))
    }

    /**
     * Run an action in its request's container: create the controller with the request's context and signal, validate
     * the input (the request's data, overridden by the address parameters), check the access and call the action
     * method with the validated input.
     * @param details The action.
     * @param invocation The request.
     * @returns The action's result.
     * @throws {Error} The input validation error, the access control's denial ({@link AccessDeniedException} or the
     * rule's error), or the action's error.
     * @protected
     */
    protected async runAction(details: ActionDetails, invocation: ActionInvocation): Promise<unknown> {
        const {context, container, params} = invocation
        //The controller of the request, shared by the objects of the request
        const controller: Controller = await container.getShared(details.constructor, {context: context, signal: invocation.signal})
        //The parameters of the address take precedence over the data of the request
        const data: Record<string, any> = params && Object.keys(params).length ? {...context.data, ...params} : context.data
        //The input is detached from the context, whose values are proxies validating their changes
        const input: Record<string, any> = cloneDeep(await this.validateInput(details.dtoConstructor, data, context.locale))
        await this.runAccessControl(this.rules, container, As(context), input, details)
        return await controller.getMethod(As(details.method))(input)
    }

    /**
     * Validate an action's input. An invalid input of a request with a language is validated again in it, so the
     * error is in that language (a valid input is validated once, with the default settings).
     * @param dtoConstructor The action's DTO.
     * @param data The input to validate.
     * @param locale The request's language (`context.locale`).
     * @returns The validated input, with its defaults and conversions applied.
     * @throws {Error} The validation error.
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
     * Dispatch a request to an action in a new request container, tracked as in progress for its adapter until it
     * ends. A request whose signal is already aborted is not run and resolves to `undefined`.
     * @param started The adapter receiving the request.
     * @param entry The action.
     * @param runner The action's middleware pipeline.
     * @param context The request's context.
     * @param options The request's abort signal and address parameters.
     * @returns The action's result, `undefined` when the request is aborted by its client.
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
     * Execute a request in a new request container, destroyed when it ends. An aborted request settles at once: its
     * container is destroyed and its result or error dropped.
     * @param entry The action.
     * @param runner The action's middleware pipeline.
     * @param context The request's context.
     * @param signal The request's abort signal.
     * @param params The parameters taken from the request's address.
     * @returns The action's result, `undefined` when the request is aborted by its client.
     * @throws {EntrypointStoppedException} When the request is aborted because the entrypoint stopped.
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
     * The descriptions of a channel's actions.
     * @param channel The channel's name.
     * @returns The descriptions, empty when the channel has no actions.
     * @protected
     */
    protected actionInfos<T extends BaseActionInfo>(channel: string): T[] {
        return As<T[]>([...(this.#channels.get(channel)?.infos.values() ?? [])])
    }

    /**
     * The descriptions of the HTTP actions.
     * @protected
     */
    protected get HTTP_ACTIONS(): HTTPActionInfo[] {
        return this.actionInfos('http')
    }

    /**
     * The descriptions of the service actions.
     * @protected
     */
    protected get SERVICE_ACTIONS(): ServiceActionInfo[] {
        return this.actionInfos('service')
    }

    /**
     * The descriptions of the CLI actions.
     * @protected
     */
    protected get CLI_ACTIONS(): CLIActionInfo[] {
        return this.actionInfos('cli')
    }

    /**
     * The actions of a channel, with the groups they belong to.
     * @param channel The channel's name.
     * @param actionGroups The group names by id.
     * @returns The actions and their groups.
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
     * The group ids used by the actions but missing from the action groups.
     * @param actionInfoMap The action descriptions by id.
     * @param actionGroups The group names by id.
     * @returns The missing group ids, each once.
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
     * The names shared by the actions of several controller methods (the addresses of one method, such as its two
     * routes, share its name).
     * @param actionInfoMap The action descriptions by id.
     * @returns The duplicate names, each once.
     * @protected
     */
    protected findDuplicateActionNames(actionInfoMap: Map<string, BaseActionInfo>): string[] {
        const methods: Map<string, string> = new Map()
        const duplicates: Set<string> = new Set()
        actionInfoMap.forEach((action: BaseActionInfo): void => {
            const method: string = `${action.controller}:${action.method}`
            const seen: string | undefined = methods.get(action.name)
            if (seen === undefined) methods.set(action.name, method)
            else if (seen !== method) duplicates.add(action.name)
        })
        return [...duplicates]
    }

    /**
     * Check the access to an action with {@link Entrypoint.accessControl}.
     * @param rules The access control rule classes.
     * @param runtimeContainer The request's container, where the rules are created.
     * @param context The request's context.
     * @param input The validated input.
     * @param details The action.
     * @throws {AccessDeniedException} When a rule denies the access (or the error a rule throws).
     * @protected
     */
    protected async runAccessControl(rules: IBaseObjectConstructor<AccessControlRule>[], runtimeContainer: Container, context: CLIContext | HTTPContext | ServiceContext, input: Record<string, any>, details: ActionDetails): Promise<void> {
        const [allowed, exception] = await this.accessControl.run(rules, runtimeContainer, context, input, details, (type: ContextType | string): BaseActionInfo[] => {
            const channel: ChannelDefinition | undefined = getChannelByContextType(type)
            return channel ? this.actionInfos(channel.name) : []
        })
        if (!allowed) throw exception
    }

    /**
     * Push an event to a client of the adapters which have clients (an Electron window's renderer, a Socket.IO
     * socket); its listeners receive the arguments. The client of a service request is its `context.clientId`.
     * @param clientId The client's id.
     * @param event The event's name.
     * @param args The arguments given to the client's listeners.
     * @returns Whether an adapter has the client; `false` when it is gone or no adapter has clients.
     */
    public notify(clientId: string, event: string, ...args: unknown[]): boolean {
        let notified: boolean = false
        for (const {adapter} of this.#started) if (adapter.notify?.(clientId, event, args)) notified = true
        return notified
    }

    /**
     * Push an event to every client of the adapters which have clients (Electron windows, Socket.IO sockets); their
     * listeners receive the arguments.
     * @param event The event's name.
     * @param args The arguments given to the clients' listeners.
     * @returns The number of clients the event was pushed to.
     */
    public broadcast(event: string, ...args: unknown[]): number {
        let clients: number = 0
        for (const {adapter} of this.#started) clients += adapter.broadcast?.(event, args) ?? 0
        return clients
    }

    /**
     * The HTTP action groups configured by the `httpActionGroups` option.
     * @returns The group names by id.
     */
    public getHttpActionGroups(): Record<string, string> {
        return this.httpActionGroups
    }

    /**
     * The service action groups configured by the `serviceActionGroups` option.
     * @returns The group names by id.
     */
    public getServiceActionGroups(): Record<string, string> {
        return this.serviceActionGroups
    }

    /**
     * The CLI action groups configured by the `cliActionGroups` option.
     * @returns The group names by id.
     */
    public getCliActionGroups(): Record<string, string> {
        return this.cliActionGroups
    }

    /**
     * The HTTP actions, with the groups they belong to (named after `httpActionGroups`).
     * @returns The actions and their groups.
     */
    public getHttpActions(): EntrypointActions<HTTPActionInfo> {
        return this.getEntrypointActions('http', this.httpActionGroups)
    }

    /**
     * The service actions, with the groups they belong to (named after `serviceActionGroups`).
     * @returns The actions and their groups.
     */
    public getServiceActions(): EntrypointActions<ServiceActionInfo> {
        return this.getEntrypointActions('service', this.serviceActionGroups)
    }

    /**
     * The CLI actions, with the groups they belong to (named after `cliActionGroups`).
     * @returns The actions and their groups.
     */
    public getCliActions(): EntrypointActions<CLIActionInfo> {
        return this.getEntrypointActions('cli', this.cliActionGroups)
    }

    /**
     * The actions of any channel, with the groups they belong to; the groups have no name (use the methods of the
     * built-in channels, such as {@link Entrypoint.getHttpActions}, for named groups).
     * @param channel The channel's name (`http`, `cli`, `service`, `schedule`, or a channel of another package).
     * @returns The actions and their groups, empty when the channel has no actions.
     */
    public getActions<T extends BaseActionInfo = BaseActionInfo & Record<string, unknown>>(channel: string): EntrypointActions<T> {
        return this.getEntrypointActions<T>(channel)
    }
}
