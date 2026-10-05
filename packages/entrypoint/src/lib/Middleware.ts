import {Container, Provider, type IBaseObjectConstructor} from '@lakutata/core'
import {isSubclassOf} from '@lakutata/utils'
import type {CLIContext} from '../context/CLIContext.js'
import type {HTTPContext} from '../context/HTTPContext.js'
import type {ServiceContext} from '../context/ServiceContext.js'
import type {CLIActionInfo, HTTPActionInfo, ServiceActionInfo} from '../Entrypoint.js'
import type {BaseContext} from '../context/BaseContext.js'
import type {ChannelActionInfo} from '../channel/EntrypointAdapter.js'
import {InvalidMiddlewareException} from '../exceptions/InvalidMiddlewareException.js'
import {MiddlewareNextCalledException} from '../exceptions/MiddlewareNextCalledException.js'

/**
 * A request to a controller action, as the middlewares receive it.
 */
export interface ActionInvocation {
    /**
     * The request's context; its `data` is the action's input before validation (a middleware may change it).
     */
    readonly context: CLIContext | HTTPContext | ServiceContext | BaseContext
    /**
     * The requested action's description.
     */
    readonly action: HTTPActionInfo | CLIActionInfo | ServiceActionInfo | ChannelActionInfo
    /**
     * The parameters taken from the request's address (such as route parameters), merged over the data into the
     * input.
     */
    readonly params?: Record<string, unknown>
    /**
     * The request's container, destroyed when the request ends: the controller and the middleware classes are
     * created in it.
     */
    readonly container: Container
    /**
     * Aborts when the request is aborted (its client gone, the entrypoint stopping).
     */
    readonly signal?: AbortSignal
}

/**
 * Run the rest of the pipeline: the next middlewares, then the input validation, the access control and the action.
 * It may be called once per middleware; a second call rejects with a `MiddlewareNextCalledException`.
 * @returns The action's result, as the next middlewares return it.
 */
export type Next = () => Promise<unknown>

/**
 * A middleware function: it runs around the rest of the pipeline (see {@link Middleware.handle}).
 * @param invocation The request.
 * @param next Runs the rest of the pipeline.
 * @returns The result given to the previous middleware (finally, to the adapter).
 */
export type MiddlewareHandler = (invocation: ActionInvocation, next: Next) => Promise<unknown>

/**
 * A middleware class: it runs around the actions, created in each request's container (its dependencies are
 * injected). Give it, or a {@link MiddlewareHandler} function, to the entrypoint's `middlewares` option (every
 * action), an adapter's `middlewares` option (its requests), `@UseMiddlewares` (a controller class or a method) or an
 * action's `middlewares` option. They run in that order: the entrypoint's, the adapter's, the controller parents'
 * then the controller's, the action option's, then the method's.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller, Middleware, type ActionInvocation, type Next} from 'lakutata/com/entrypoint'
 * import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'
 *
 * //Log the duration of each request
 * class Timing extends Middleware {
 *     public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
 *         const start: number = Date.now()
 *         try {
 *             return await next()
 *         } finally {
 *             console.log(`${invocation.action.name}: ${Date.now() - start}ms`)
 *         }
 *     }
 * }
 *
 * @UseMiddlewares(async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
 *     //Short-circuit: the action does not run
 *     if (invocation.context.data.maintenance) return {error: 'maintenance'}
 *     return next()
 * })
 * class StatusController extends Controller {
 *     @GET('/status')
 *     public async status(): Promise<string> {
 *         return 'ok'
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'status.app',
 *     name: 'Status',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [StatusController],
 *             middlewares: [Timing]
 *         })
 *     }
 * }))
 * ```
 */
export abstract class Middleware extends Provider {

    /**
     * Handle a request: call `next()` to continue the pipeline and return its result (changed or not), or return
     * without calling it to answer instead of the action. A thrown error fails the request.
     * @param invocation The request.
     * @param next Runs the rest of the pipeline; once at most.
     * @returns The result given to the previous middleware (finally, to the adapter).
     */
    public abstract handle(invocation: ActionInvocation, next: Next): Promise<unknown>
}

/**
 * A middleware: a {@link Middleware} subclass, created in each request's container, or a {@link MiddlewareHandler}
 * function. Any other value (a class not extending `Middleware` included) fails with an `InvalidMiddlewareException`.
 */
export type MiddlewareDefinition = IBaseObjectConstructor<Middleware> | MiddlewareHandler

export type InvocationRunner = (invocation: ActionInvocation) => Promise<unknown>

const CLASS_MIDDLEWARES: symbol = Symbol('ENTRYPOINT.CLASS.MIDDLEWARES')

const METHOD_MIDDLEWARES: symbol = Symbol('ENTRYPOINT.METHOD.MIDDLEWARES')

/**
 * Whether a middleware is a middleware class
 * @param middleware
 */
export function IsMiddlewareClass(middleware: MiddlewareDefinition): middleware is IBaseObjectConstructor<Middleware> {
    return isSubclassOf(middleware, Middleware)
}

/**
 * Check middleware definitions: middleware classes or functions
 * @param middlewares
 */
export function ValidateMiddlewares(middlewares: unknown[]): MiddlewareDefinition[] {
    for (const middleware of middlewares) {
        if (typeof middleware !== 'function') throw new InvalidMiddlewareException('A middleware must be a function or a class extending Middleware')
        if (!IsMiddlewareClass(middleware as MiddlewareDefinition) && /^class[\s{]/.test(Function.prototype.toString.call(middleware)))
            throw new InvalidMiddlewareException('The middleware class "{0}" does not extend Middleware', [middleware.name])
    }
    return middlewares as MiddlewareDefinition[]
}

/**
 * Add middlewares to a controller class or an action method, the middlewares of each decorator run in their order,
 * the decorators from top to bottom
 * @param target
 * @param propertyKey
 * @param middlewares
 */
export function AddMiddlewares(target: object, propertyKey: string | symbol | undefined, middlewares: MiddlewareDefinition[]): void {
    const key: symbol = propertyKey === undefined ? CLASS_MIDDLEWARES : METHOD_MIDDLEWARES
    const existing: MiddlewareDefinition[] = (propertyKey === undefined ? Reflect.getOwnMetadata(key, target) : Reflect.getOwnMetadata(key, target, propertyKey)) || []
    //The decorators are applied from bottom to top
    const merged: MiddlewareDefinition[] = [...ValidateMiddlewares(middlewares), ...existing]
    propertyKey === undefined ? Reflect.defineMetadata(key, merged, target) : Reflect.defineMetadata(key, merged, target, propertyKey)
}

/**
 * The middlewares of a controller class, the ones of its parent classes first
 * @param controller
 */
export function GetClassMiddlewares(controller: Function): MiddlewareDefinition[] {
    const chain: Function[] = []
    for (let current: any = controller; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) chain.unshift(current)
    return chain.flatMap((constructor: Function): MiddlewareDefinition[] => Reflect.getOwnMetadata(CLASS_MIDDLEWARES, constructor) || [])
}

/**
 * The middlewares of an action method, declared on the method in the class hierarchy
 * @param controller
 * @param method
 */
export function GetMethodMiddlewares(controller: Function, method: string | symbol): MiddlewareDefinition[] {
    for (let prototype: any = controller.prototype; prototype; prototype = Object.getPrototypeOf(prototype)) {
        const middlewares: MiddlewareDefinition[] | undefined = Reflect.getOwnMetadata(METHOD_MIDDLEWARES, prototype, method)
        if (middlewares) return middlewares
    }
    return []
}

/**
 * Compose middlewares around the innermost runner
 * @param middlewares
 * @param innermost
 */
export function ComposeMiddlewares(middlewares: MiddlewareDefinition[], innermost: InvocationRunner): InvocationRunner {
    return middlewares.reduceRight((next: InvocationRunner, middleware: MiddlewareDefinition): InvocationRunner => {
        const handle: MiddlewareHandler = IsMiddlewareClass(middleware)
            ? async (invocation: ActionInvocation, nextStep: Next): Promise<unknown> => (await invocation.container.get(middleware)).handle(invocation, nextStep)
            : middleware
        return (invocation: ActionInvocation): Promise<unknown> => {
            let called: boolean = false
            return handle(invocation, (): Promise<unknown> => {
                if (called) return Promise.reject(new MiddlewareNextCalledException('next() is called more than once'))
                called = true
                return next(invocation)
            })
        }
    }, innermost)
}
