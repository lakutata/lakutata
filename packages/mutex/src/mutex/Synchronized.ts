import type {Mutex} from './Mutex.js'
import type {MutexLock} from './MutexLock.js'

/**
 * The options of {@link Synchronized}: the lock component used, and how the lock is waited for and held.
 */
export type SynchronizedOptions = {
    /**
     * The name under which the {@link Mutex} component is registered, resolved from the controller's container.
     * @default 'mutex'
     */
    mutex?: string
    /**
     * How long the request waits for the lock, in milliseconds, before failing with a {@link MutexTimeoutException}.
     * Ignored when `wait` is `false`.
     * @default the component's `timeout` option (10000)
     */
    timeout?: number
    /**
     * Whether to wait for the lock; `false` fails the request at once with a {@link MutexTimeoutException} (HTTP 409)
     * when another request holds the lock.
     * @default true
     */
    wait?: boolean
    /**
     * How long the lock stays held without a renewal, in milliseconds (renewed automatically while the action runs).
     * @default the component's `ttl` option (30000)
     */
    ttl?: number
}

/**
 * Build a lock name from a template, replacing each `{field}` with that field of the input (`{a.b}` reads a nested
 * field). {@link Synchronized} uses it for its template names; a template without `{}` is returned as it is.
 * @param template The template, such as `'order:{id}'` or `'user:{user.id}:export'`.
 * @param input The object whose fields fill the template (an action's validated input).
 * @returns The lock name.
 * @throws {TypeError} When a field of the template is missing, `null`, or an object (only strings, numbers and other
 * primitives are accepted).
 * @example
 * ```typescript
 * import {lockNameOf} from 'lakutata/com/mutex'
 *
 * console.log(lockNameOf('order:{id}', {id: 42})) //order:42
 * console.log(lockNameOf('user:{user.id}:export', {user: {id: 'u7'}})) //user:u7:export
 * ```
 */
export function lockNameOf(template: string, input: unknown): string {
    return template.replace(/\{([^{}]+)}/g, (_: string, field: string): string => {
        const value: unknown = field.split('.').reduce((current: any, key: string): unknown => current === null || current === undefined ? undefined : current[key], input)
        if (value === undefined || value === null || (typeof value === 'object')) throw new TypeError(`The lock "${template}" needs the field ${field} of the input of the action (a string or a number)`)
        return String(value)
    })
}

/**
 * Run a controller action holding a lock, acquired once its input is validated and its access control passed, released
 * after it (whether it returns or throws). The requests needing the same lock run one at a time in every instance
 * sharing the lock store, whatever their transport (HTTP, CLI, service); the others run in parallel.
 *
 * The lock comes from the {@link Mutex} component registered as `mutex` (or `options.mutex`); a missing component
 * fails the request. The wait for the lock stops when the request is aborted (its client gone), and a request not
 * getting the lock in time fails with a {@link MutexTimeoutException} (HTTP 409). The action is not interrupted when
 * its lock is lost: check the controller's `this.signal` for a long work.
 * @param name The lock name: a template filled from the fields of the action's input (`'order:{id}'`, see
 * {@link lockNameOf}; a missing field fails the request with a `TypeError`), or a function of the input and the
 * request's context returning it.
 * @param options The lock component, the wait and the lock's `ttl`.
 * @returns The method decorator.
 * @throws {TypeError} When the class is declared, if the name is neither a non-empty string nor a function, or if the
 * decorated member is not a method.
 * @throws {MutexTimeoutException} From the action, when the lock is not acquired in time (HTTP 409).
 * @throws {MutexDriverException} From the action, when the lock store fails.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Synchronized} from 'lakutata/com/mutex'
 *
 * class OrderController extends Controller {
 *     //The payments of an order one at a time, the other orders in parallel
 *     @ServiceAction({cmd: 'order.pay'})
 *     @Synchronized('order:{id}')
 *     public async pay(input: {id: number}): Promise<void> {
 *     }
 *
 *     //Fails at once (HTTP 409) while another request rebuilds the index
 *     @ServiceAction({cmd: 'search.reindex'})
 *     @Synchronized('search:reindex', {wait: false})
 *     public async reindex(): Promise<void> {
 *     }
 *
 *     //A lock named by a function, from the component registered as "locks"
 *     @ServiceAction({cmd: 'user.export'})
 *     @Synchronized((input: {userId: string}): string => `export:${input.userId}`, {timeout: 5000, mutex: 'locks'})
 *     public async export(input: {userId: string}): Promise<void> {
 *     }
 * }
 * ```
 */
export function Synchronized(name: string | ((input: any, context: any) => string), options: SynchronizedOptions = {}): (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor {
    if (typeof name !== 'function' && (typeof name !== 'string' || !name)) throw new TypeError('The lock of a synchronized action is a template or a function')
    return (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor => {
        const action: (...args: unknown[]) => unknown = descriptor.value
        if (typeof action !== 'function') throw new TypeError(`@Synchronized decorates a method (${String(propertyKey)})`)
        descriptor.value = async function (this: any, ...args: unknown[]): Promise<unknown> {
            const input: unknown = args[0] ?? {}
            const lockName: string = typeof name === 'function' ? name(input, this.context) : lockNameOf(name, input)
            const mutex: Mutex = await this.getObject(options.mutex ?? 'mutex')
            return await mutex.synchronized(lockName, (_lock: MutexLock): unknown => action.apply(this, args), {
                timeout: options.wait === false ? 0 : options.timeout,
                ttl: options.ttl,
                signal: this.signal
            })
        }
        return descriptor
    }
}
