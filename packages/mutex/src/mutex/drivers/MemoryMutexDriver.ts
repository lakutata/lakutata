import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {lockToken} from '../lib/Names.js'

/**
 * The locks of the process, shared by its components: the ones of a single instance (its development, its tests)
 */
const LOCKS: Map<string, { token: string, expires: number }> = new Map()

let FENCE: number = 0

/**
 * The memory driver (`{type: 'memory'}`, the default of a {@link Mutex}): the locks live in the process memory, shared
 * by every component and driver of the process using the same prefix, and invisible to the other processes. Use it for
 * development, tests and an application running as a single process. It needs no package.
 *
 * The locks expire after their `ttl` unless renewed. The fencing token is a counter of the process, starting again at 1
 * when the process restarts. The locks are lost with the process.
 * @example
 * ```typescript
 * import {MemoryMutexDriver, type DriverLock} from 'lakutata/com/mutex'
 *
 * const driver: MemoryMutexDriver = new MemoryMutexDriver('test:')
 * const first: DriverLock | undefined = await driver.acquire('job', 1000)
 * console.log(await driver.acquire('job', 1000)) //undefined: held by the first
 * if (first) console.log(await driver.release('job', first)) //true
 * await driver.close()
 * ```
 */
export class MemoryMutexDriver extends MutexDriver {

    /**
     * `true`: the locks expire after their `ttl` unless renewed.
     */
    public readonly expiring: boolean = true

    readonly #locks: Map<string, { token: string, expires: number }> = LOCKS

    /**
     * Create a driver on the process memory.
     * @param prefix The prefix added to the lock names; the drivers of the process with the same prefix share their
     * locks. `''` by default.
     */
    constructor(protected readonly prefix: string = '') {
        super()
    }

    /**
     * Try to acquire a lock once: granted when nobody holds it or its holder let it expire.
     * @param name The lock name.
     * @param ttl How long the lock stays held without a renewal, in milliseconds.
     * @returns The lock with a fencing token, or `undefined` when another holder has it.
     */
    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const key: string = this.prefix + name
        const current = this.#locks.get(key)
        if (current && current.expires > Date.now()) return undefined
        const lock: DriverLock = {token: lockToken(), fence: ++FENCE}
        this.#locks.set(key, {token: lock.token, expires: Date.now() + ttl})
        return lock
    }

    /**
     * Release a lock still held by this holder.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @returns Whether it was released (`false` when another holder has taken it since).
     */
    public async release(name: string, lock: DriverLock): Promise<boolean> {
        if (this.#locks.get(this.prefix + name)?.token !== lock.token) return false
        this.#locks.delete(this.prefix + name)
        return true
    }

    /**
     * Renew a lock still held by this holder, for `ttl` milliseconds from now. A lock expired is not renewed (lost),
     * even when no other holder took it yet.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @param ttl How long the lock stays held without another renewal, in milliseconds.
     * @returns Whether it was renewed.
     */
    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const current = this.#locks.get(this.prefix + name)
        //Expired: lost, even when nobody took it yet
        if (current?.token !== lock.token || current.expires <= Date.now()) return false
        current.expires = Date.now() + ttl
        return true
    }

    /**
     * Do nothing: the locks stay in the process memory until they are released or expire.
     */
    public async close(): Promise<void> {
        //The locks of the process kept: the ones of this component are released by it
    }
}
