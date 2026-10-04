import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LockToken} from '../lib/Names.js'

/**
 * The locks of the process, shared by its components: the ones of a single instance (its development, its tests)
 */
const LOCKS: Map<string, { token: string, expires: number }> = new Map()

let FENCE: number = 0

/**
 * The locks of the process: the ones of a single instance (its development, its tests)
 */
export class MemoryMutexDriver extends MutexDriver {

    public readonly expiring: boolean = true

    readonly #locks: Map<string, { token: string, expires: number }> = LOCKS

    constructor(protected readonly prefix: string = '') {
        super()
    }

    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const key: string = this.prefix + name
        const current = this.#locks.get(key)
        if (current && current.expires > Date.now()) return undefined
        const lock: DriverLock = {token: LockToken(), fence: ++FENCE}
        this.#locks.set(key, {token: lock.token, expires: Date.now() + ttl})
        return lock
    }

    public async release(name: string, lock: DriverLock): Promise<boolean> {
        if (this.#locks.get(this.prefix + name)?.token !== lock.token) return false
        this.#locks.delete(this.prefix + name)
        return true
    }

    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const current = this.#locks.get(this.prefix + name)
        if (current?.token !== lock.token) return false
        current.expires = Date.now() + ttl
        return true
    }

    public async close(): Promise<void> {
        //The locks of the process kept: the ones of this component are released by it
    }
}
