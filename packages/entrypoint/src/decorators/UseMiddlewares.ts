import {addMiddlewares, MiddlewareDefinition, validateMiddlewares} from '../lib/Middleware.js'

/**
 * Add middlewares to all the actions of a controller (on the class) or to one action (on the method). A middleware is a
 * function `(invocation, next) => Promise<unknown>` or a class extending `Middleware`, created in the container of each
 * request (its dependencies injected). It receives the request's context, whose data is the input before validation,
 * and returns the result of `next()` (the rest of the pipeline), or another value without calling it, which is then
 * answered instead of the action's result; an error it throws is answered as the action's error.
 *
 * The order of a request: the entrypoint's `middlewares`, the adapter's `middlewares`, the ones of the controller classes
 * (the parent classes first), of the action options, of the action method, then the input validation, the access
 * control and the action. Several `@UseMiddlewares` on a target run from top to bottom, the middlewares of each in their
 * order. The middlewares of a method are taken from the nearest class declaring them for it: an overriding method
 * replaces them.
 * @param middlewares The middleware functions and classes, in their running order.
 * @returns The class or method decorator.
 * @throws {InvalidMiddlewareException} When the decorator is called, if a middleware is neither a function nor a class
 * extending `Middleware`.
 * @example
 * ```typescript
 * import {Controller, Middleware, type ActionInvocation, type Next} from 'lakutata/com/entrypoint'
 * import {GET, UseMiddlewares} from 'lakutata/decorator/ctrl'
 *
 * //A middleware function: logs the duration of each action of the controller
 * async function Timing(invocation: ActionInvocation, next: Next): Promise<unknown> {
 *     const started: number = Date.now()
 *     try {
 *         return await next()
 *     } finally {
 *         console.log(`${invocation.action.name}: ${Date.now() - started}ms`)
 *     }
 * }
 *
 * //A middleware class: answers without running the action during a maintenance
 * class Maintenance extends Middleware {
 *     public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
 *         if (process.env.MAINTENANCE) return {maintenance: true}
 *         return await next()
 *     }
 * }
 *
 * @UseMiddlewares(Timing)
 * class StatusController extends Controller {
 *     //Timing, then Maintenance, then the action
 *     @GET('/status')
 *     @UseMiddlewares(Maintenance)
 *     public async status(): Promise<{ ok: boolean }> {
 *         return {ok: true}
 *     }
 * }
 * ```
 */
export function UseMiddlewares(...middlewares: MiddlewareDefinition[]): (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void {
    validateMiddlewares(middlewares)
    return (target: object, propertyKey?: string | symbol): void => addMiddlewares(target, propertyKey, middlewares)
}
