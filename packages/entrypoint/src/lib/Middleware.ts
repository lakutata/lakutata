import {Container, Provider} from '@lakutata/core'
import type {IBaseObjectConstructor} from '@lakutata/core'
import {IsSubclassOf} from '@lakutata/core/internal'
import type {CLIContext} from '../context/CLIContext.js'
import type {HTTPContext} from '../context/HTTPContext.js'
import type {ServiceContext} from '../context/ServiceContext.js'
import type {CLIActionInfo, HTTPActionInfo, ServiceActionInfo} from '../Entrypoint.js'
import {InvalidMiddlewareException} from '../exceptions/InvalidMiddlewareException.js'
import {MiddlewareNextCalledException} from '../exceptions/MiddlewareNextCalledException.js'

/**
 * An invocation of a controller action
 */
export interface ActionInvocation {
    /**
     * The context of the request, its data is the input before validation
     */
    readonly context: CLIContext | HTTPContext | ServiceContext
    /**
     * The invoked action
     */
    readonly action: HTTPActionInfo | CLIActionInfo | ServiceActionInfo
    /**
     * The container of the request
     */
    readonly container: Container
    /**
     * The signal of the abort of the request
     */
    readonly signal?: AbortSignal
}

/**
 * Run the rest of the pipeline: the next middlewares, then the input validation, the access control and the action
 */
export type Next = () => Promise<unknown>

/**
 * A middleware function
 */
export type MiddlewareHandler = (invocation: ActionInvocation, next: Next) => Promise<unknown>

/**
 * A middleware class, created in the container of each request (its dependencies can be injected)
 */
export abstract class Middleware extends Provider {

    /**
     * Handle an action invocation, call next() to continue the pipeline and return its result, or return without calling it
     * @param invocation
     * @param next
     */
    public abstract handle(invocation: ActionInvocation, next: Next): Promise<unknown>
}

export type MiddlewareDefinition = IBaseObjectConstructor<Middleware> | MiddlewareHandler

export type InvocationRunner = (invocation: ActionInvocation) => Promise<unknown>

const CLASS_MIDDLEWARES: symbol = Symbol('ENTRYPOINT.CLASS.MIDDLEWARES')

const METHOD_MIDDLEWARES: symbol = Symbol('ENTRYPOINT.METHOD.MIDDLEWARES')

/**
 * Whether a middleware is a middleware class
 * @param middleware
 */
export function IsMiddlewareClass(middleware: MiddlewareDefinition): middleware is IBaseObjectConstructor<Middleware> {
    return IsSubclassOf(middleware, Middleware)
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
