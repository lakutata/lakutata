import type {ActionPattern, BaseObject, DTO, IBaseObjectConstructor, JSONSchema, Module, Schema} from '@lakutata/core'
import type {Controller} from '../lib/Controller.js'
import type {BaseContext} from '../context/BaseContext.js'
import type {BaseActionInfo} from '../Entrypoint.js'
import type {MiddlewareDefinition} from '../lib/Middleware.js'
import type {ChannelDefinition} from './Channel.js'

/**
 * The options of a dispatch
 */
export interface DispatchOptions {
    /**
     * The signal of the abort of the request
     */
    readonly signal?: AbortSignal
    /**
     * The parameters taken from the address of the request by the transport (such as the route parameters),
     * they take precedence over the data of the request
     */
    readonly params?: Record<string, unknown>
}

/**
 * The information of an action given to the adapters: one per address (an HTTP route declared for two methods has two)
 */
export type ChannelActionInfo = BaseActionInfo & Record<string, unknown> & {
    /**
     * The address of the action in its channel
     */
    readonly address: ActionPattern
    /**
     * The DTO of the input of the action
     */
    readonly dto: typeof DTO
    /**
     * The schema of the result of the action, declared with @Return (undefined without it)
     */
    readonly returnSchema: Schema | undefined
}

/**
 * The handle given by the entrypoint to an adapter
 */
export interface ChannelRuntime<Context extends BaseContext = BaseContext> {
    /**
     * The channel of the adapter
     */
    readonly channel: ChannelDefinition
    /**
     * The module of the entrypoint
     */
    readonly module: Module
    /**
     * The actions of the channel
     */
    readonly actions: ReadonlyArray<ChannelActionInfo>
    /**
     * The controllers of the entrypoint, for the channels declaring what the controllers serve besides their actions (their prefixes, their metadata)
     */
    readonly controllers: ReadonlyArray<IBaseObjectConstructor<Controller>>

    /**
     * Get an object of the application from the container of the entrypoint (the components serving the adapter, such as the autoloaded ones)
     * @param target
     */
    getObject<T extends BaseObject>(target: string | symbol | IBaseObjectConstructor<T>): Promise<T>
    /**
     * Resolved once every adapter of the entrypoint started and the application launched (all its objects and its bootstrap are ready),
     * for the adapters which act on their own rather than on the requests (running a command, triggering the schedules)
     */
    readonly ready: Promise<void>

    /**
     * Dispatch a request to the action it matches
     * @param context
     * @param options
     */
    dispatch(context: Context, options?: DispatchOptions): Promise<unknown>

    /**
     * Dispatch a request to an action, for the channels which bind a trigger to each action (schedules, subscriptions)
     * @param action one of the actions of the runtime
     * @param context
     * @param options
     */
    dispatchTo(action: ChannelActionInfo, context: Context, options?: DispatchOptions): Promise<unknown>
}

/**
 * An adapter: a transport of a channel
 */
export interface EntrypointAdapter<Context extends BaseContext = BaseContext> {
    /**
     * The channel of the adapter, which is also its key in the entrypoint options
     */
    readonly channel: string
    /**
     * The channel definition, defined when the adapter is created
     */
    readonly definition?: ChannelDefinition
    /**
     * The adapter name, to tell apart the adapters of a channel
     */
    readonly name?: string
    /**
     * The middlewares of the requests of this adapter, run after the global ones
     */
    readonly middlewares?: MiddlewareDefinition[]

    /**
     * Start receiving the requests
     * @param runtime
     */
    start(runtime: ChannelRuntime<Context>): void | Promise<void>

    /**
     * Stop receiving the requests, the entrypoint then waits for the requests in progress
     */
    stop?(): void | Promise<void>

    /**
     * Release the resources (connections, servers) once the requests in progress ended or were aborted
     */
    close?(): void | Promise<void>
}

/**
 * Whether a value is an adapter
 * @param value
 */
export function IsEntrypointAdapter(value: unknown): value is EntrypointAdapter {
    return !!value && typeof value === 'object' && typeof (value as EntrypointAdapter).channel === 'string' && typeof (value as EntrypointAdapter).start === 'function'
}

/**
 * The JSON schemas of the commands of the CLI actions
 * @param actions
 */
export function CommandMap(actions: ReadonlyArray<ChannelActionInfo>): Map<string, JSONSchema> {
    return new Map(actions.map((action: ChannelActionInfo): [string, JSONSchema] => [action.command as string, action.jsonSchema]))
}
