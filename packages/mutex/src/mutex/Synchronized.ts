import type {Mutex} from './Mutex.js'
import type {MutexLock} from './MutexLock.js'

/**
 * The options of a synchronized action
 */
export type SynchronizedOptions = {
    /**
     * The name of the component of the locks, "mutex" by default
     */
    mutex?: string
    /**
     * Milliseconds the lock is waited for, the one of the component by default
     */
    timeout?: number
    /**
     * Wait for the lock (default), or fail at once when another request holds it
     */
    wait?: boolean
    /**
     * Milliseconds the lock is held without renewal, the one of the component by default
     */
    ttl?: number
}

/**
 * The name of a lock of a template: its {fields} the ones of the input (a.b for the nested ones)
 * @param template
 * @param input
 */
export function LockNameOf(template: string, input: unknown): string {
    return template.replace(/\{([^{}]+)}/g, (_: string, field: string): string => {
        const value: unknown = field.split('.').reduce((current: any, key: string): unknown => current === null || current === undefined ? undefined : current[key], input)
        if (value === undefined || value === null || (typeof value === 'object')) throw new TypeError(`The lock "${template}" needs the field ${field} of the input of the action (a string or a number)`)
        return String(value)
    })
}

/**
 * Method Decorator, run a controller action holding a lock (acquired after the validation of its input and its access
 * control, released after it): the actions of a same lock one at a time in all the instances, the other ones in
 * parallel. The lock is named by a template of the fields of the input ("order:{id}") or by a function of the input
 * and the context; its wait stops when the request is aborted (its client gone)
 * @param name
 * @param options
 */
export function Synchronized(name: string | ((input: any, context: any) => string), options: SynchronizedOptions = {}): (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor {
    if (typeof name !== 'function' && (typeof name !== 'string' || !name)) throw new TypeError('The lock of a synchronized action is a template or a function')
    return (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor => {
        const action: (...args: unknown[]) => unknown = descriptor.value
        if (typeof action !== 'function') throw new TypeError(`@Synchronized decorates a method (${String(propertyKey)})`)
        descriptor.value = async function (this: any, ...args: unknown[]): Promise<unknown> {
            const input: unknown = args[0] ?? {}
            const lockName: string = typeof name === 'function' ? name(input, this.context) : LockNameOf(name, input)
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
