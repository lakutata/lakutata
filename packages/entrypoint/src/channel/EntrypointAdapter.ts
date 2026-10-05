import type {ActionPattern, BaseObject, DTO, IBaseObjectConstructor, JSONSchema, Module, Schema} from '@lakutata/core'
import type {Controller} from '../lib/Controller.js'
import type {BaseContext} from '../context/BaseContext.js'
import type {BaseActionInfo} from '../Entrypoint.js'
import type {MiddlewareDefinition} from '../lib/Middleware.js'
import type {ChannelDefinition} from './Channel.js'

/**
 * The options of a request dispatched by an adapter ({@link ChannelRuntime.dispatch}).
 */
export interface DispatchOptions {
    /**
     * Aborts the request (its client went away, its deadline passed): the controller's `signal` aborts, the request's
     * container is destroyed and the dispatch resolves to `undefined` at once. A request whose signal is already
     * aborted is not run.
     */
    readonly signal?: AbortSignal
    /**
     * The parameters the transport took from the request's address (such as route parameters); they are merged into
     * the action's input and take precedence over the request's data and the matcher's parameters.
     */
    readonly params?: Record<string, unknown>
}

/**
 * The description of an action given to the adapters ({@link ChannelRuntime.actions}): one per address (an HTTP route
 * declared for two methods has two), with the fields of its channel (`route`, `command`, `pattern`…).
 */
export type ChannelActionInfo = BaseActionInfo & Record<string, unknown> & {
    /**
     * The action's address in its channel (`{route, method}` for HTTP, `{command}` for CLI, the pattern for service),
     * with its controller prefix.
     */
    readonly address: ActionPattern
    /**
     * The DTO validating the action's input (`FlexibleDTO`, accepting any input, when the action declares none).
     */
    readonly dto: typeof DTO
    /**
     * The schema of the action's result, declared with `@Return`; `undefined` without it.
     */
    readonly returnSchema: Schema | undefined
}

/**
 * What the entrypoint gives an adapter when it starts it ({@link EntrypointAdapter.start}): the channel's actions and
 * the functions dispatching the requests to them.
 */
export interface ChannelRuntime<Context extends BaseContext = BaseContext> {
    /**
     * The adapter's channel.
     */
    readonly channel: ChannelDefinition
    /**
     * The module owning the entrypoint (the application).
     */
    readonly module: Module
    /**
     * The channel's actions, one per address.
     */
    readonly actions: ReadonlyArray<ChannelActionInfo>
    /**
     * The entrypoint's controller classes, for the channels serving what the controllers declare besides their actions
     * (their prefixes, their metadata).
     */
    readonly controllers: ReadonlyArray<IBaseObjectConstructor<Controller>>

    /**
     * Get an object from the entrypoint's container, such as a component the adapter uses (an autoloaded class is
     * registered on first use).
     * @param target The object's registration name or symbol, or its class.
     * @returns The object, once created and initialized.
     * @throws {Error} When the object is not registered or fails to be created.
     */
    getObject<T extends BaseObject>(target: string | symbol | IBaseObjectConstructor<T>): Promise<T>
    /**
     * Resolves once every adapter of the entrypoint started and the application launched (its objects and its
     * bootstrap are ready), for the adapters acting on their own rather than on requests (running a command,
     * triggering the schedules). Without an application (a bare container) it never resolves unless the entrypoint's
     * `launched()` is called.
     */
    readonly ready: Promise<void>

    /**
     * Dispatch a request to the action it matches: the request runs in a container of its own, through the
     * middlewares, the input validation, the access control and the action. It is tracked as in progress until it
     * ends, so the entrypoint waits for it when it stops.
     * @param context The request's context, of the channel's context class.
     * @param options The request's abort signal and address parameters.
     * @returns The action's result; `undefined` when the request is aborted by its signal.
     * @throws {Error} The channel's not-found error when no action matches (`ControllerActionNotFoundException` for
     * the built-in channels), the input validation error, the access control's denial (`AccessDeniedException`), the
     * error of a middleware or of the action, or `EntrypointStoppedException` when the entrypoint stopped before the
     * request completed.
     */
    dispatch(context: Context, options?: DispatchOptions): Promise<unknown>

    /**
     * Dispatch a request to a given action without matching it, for the channels binding a trigger to each action
     * (schedules, subscriptions); the request runs as with {@link ChannelRuntime.dispatch}.
     * @param action One of the objects of {@link ChannelRuntime.actions} (compared by identity, not a copy).
     * @param context The request's context, of the channel's context class.
     * @param options The request's abort signal and address parameters.
     * @returns The action's result; `undefined` when the request is aborted by its signal.
     * @throws {Error} The channel's not-found error when the action is not one of the runtime's, and the errors of
     * {@link ChannelRuntime.dispatch}.
     */
    dispatchTo(action: ChannelActionInfo, context: Context, options?: DispatchOptions): Promise<unknown>
}

/**
 * An adapter: a transport receiving a channel's requests (an HTTP server, a CLI parser, a socket server, the
 * scheduler). It is given to the entrypoint options under its channel's key; the entrypoint starts it when it
 * initializes and stops it, then closes it, when it is destroyed. The adapter packages export functions creating them
 * (`expressHTTPEntrypoint()`, `scheduleEntrypoint()`…).
 */
export interface EntrypointAdapter<Context extends BaseContext = BaseContext> {
    /**
     * The adapter's channel, which is also its key in the entrypoint options.
     */
    readonly channel: string
    /**
     * The channel's definition, defined by the entrypoint before it starts the adapter (for the packages defining their
     * channel with their adapter).
     */
    readonly definition?: ChannelDefinition
    /**
     * The adapter's name, to tell apart the adapters of a channel.
     */
    readonly name?: string
    /**
     * The middlewares run around the requests of this adapter, after the entrypoint's and before the controller's and
     * the action's.
     */
    readonly middlewares?: MiddlewareDefinition[]

    /**
     * Start receiving requests. The entrypoint starts its adapters one after the other and awaits each; a rejection
     * fails the entrypoint's initialization.
     * @param runtime The channel's actions and the functions dispatching the requests.
     */
    start(runtime: ChannelRuntime<Context>): void | Promise<void>

    /**
     * Stop receiving requests; the entrypoint then waits for the requests in progress (aborting them after its
     * `shutdownTimeout`) before it calls {@link EntrypointAdapter.close}.
     */
    stop?(): void | Promise<void>

    /**
     * Release the resources (connections, servers) once the requests in progress ended or were aborted.
     */
    close?(): void | Promise<void>

    /**
     * Push an event to a client of the adapter (a window's renderer, a socket); its listeners receive the arguments.
     * Called by {@link Entrypoint.notify}.
     * @param clientId The client's id, as set in its requests' contexts (`ServiceContext.clientId`).
     * @param event The event's name.
     * @param args The arguments given to the client's listeners.
     * @returns Whether the adapter has the client.
     */
    notify?(clientId: string, event: string, args: unknown[]): boolean

    /**
     * Push an event to every client of the adapter. Called by {@link Entrypoint.broadcast}.
     * @param event The event's name.
     * @param args The arguments given to the clients' listeners.
     * @returns The number of clients the event was pushed to.
     */
    broadcast?(event: string, args: unknown[]): number
}

/**
 * Whether a value is an adapter: an object with a string `channel` and a `start` function.
 * @param value The value to check.
 * @returns `true` when the value is an adapter.
 * @example
 * ```typescript
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 * import {isEntrypointAdapter} from '@lakutata/entrypoint/channel'
 *
 * console.log(isEntrypointAdapter(expressHTTPEntrypoint())) //true
 * console.log(isEntrypointAdapter({channel: 'http'})) //false: no start function
 * ```
 */
export function isEntrypointAdapter(value: unknown): value is EntrypointAdapter {
    return !!value && typeof value === 'object' && typeof (value as EntrypointAdapter).channel === 'string' && typeof (value as EntrypointAdapter).start === 'function'
}

/**
 * Map the commands of CLI actions to the JSON schemas of their input, as a CLI adapter builds its commands from.
 * @param actions The CLI channel's actions ({@link ChannelRuntime.actions} of a CLI adapter).
 * @returns Each command mapped to its input's JSON schema; an action without command is mapped under `undefined`.
 * @example
 * ```typescript
 * import {type CLIContext, type EntrypointAdapter} from 'lakutata/com/entrypoint'
 * import {commandMap} from '@lakutata/entrypoint/channel'
 *
 * //A CLI adapter printing the commands and their options
 * export const HelpCLIEntrypoint: EntrypointAdapter<CLIContext> = {
 *     channel: 'cli',
 *     start: (runtime): void => {
 *         for (const [command, schema] of commandMap(runtime.actions)) {
 *             console.log(command, Object.keys(schema.properties ?? {}).join(' '))
 *         }
 *     }
 * }
 * ```
 */
export function commandMap(actions: ReadonlyArray<ChannelActionInfo>): Map<string, JSONSchema> {
    return new Map(actions.map((action: ChannelActionInfo): [string, JSONSchema] => [action.command as string, action.jsonSchema]))
}
