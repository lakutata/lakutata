import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {Component, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {MutexLock} from './MutexLock.js'
import type {DriverLock, MutexDriver} from './drivers/MutexDriver.js'
import {MemoryMutexDriver} from './drivers/MemoryMutexDriver.js'
import {FileMutexDriver} from './drivers/FileMutexDriver.js'
import {RedisMutexDriver} from './drivers/RedisMutexDriver.js'
import {PostgresMutexDriver} from './drivers/PostgresMutexDriver.js'
import {MysqlMutexDriver} from './drivers/MysqlMutexDriver.js'
import {MemoryMutexOptions} from './options/MemoryMutexOptions.js'
import {FileMutexOptions} from './options/FileMutexOptions.js'
import {RedisMutexOptions} from './options/RedisMutexOptions.js'
import {PostgresMutexOptions} from './options/PostgresMutexOptions.js'
import {MysqlMutexOptions} from './options/MysqlMutexOptions.js'
import {MutexTimeoutException} from './exceptions/MutexTimeoutException.js'
import {MutexLostException} from './exceptions/MutexLostException.js'
import {MutexDriverException} from './exceptions/MutexDriverException.js'

/**
 * The options of the drivers
 */
export type MutexDriverOptions = MemoryMutexOptions | FileMutexOptions | RedisMutexOptions | PostgresMutexOptions | MysqlMutexOptions

/**
 * The options of an acquisition
 */
export type MutexAcquireOptions = {
    /**
     * Milliseconds the lock is held without renewal (renewed automatically while it is held), the one of the component
     * by default
     */
    ttl?: number
    /**
     * Milliseconds the lock is waited for: 0 tries once, Infinity waits until it is acquired; the one of the component
     * by default
     */
    timeout?: number
    /**
     * Its abort stops the wait
     */
    signal?: AbortSignal
}

/**
 * The locks of the application, shared by its instances and its processes as their driver shares them: acquired with a
 * token (only their holder releases and renews them), held for a time renewed automatically while they are held (a
 * holder gone does not keep them), released when the component is destroyed. The locks are not reentrant: acquiring a
 * lock held waits for its release, in the same process too
 */
@Singleton()
export class Mutex extends Component {

    /**
     * The driver of the locks: memory (a single instance), file (the processes of a host), redis, postgres, mysql
     */
    @Configurable(DTO.Alternatives(MemoryMutexOptions.required(), FileMutexOptions.required(), RedisMutexOptions.required(), PostgresMutexOptions.required(), MysqlMutexOptions.required()).optional().default({type: 'memory'}))
    protected readonly driver: MutexDriverOptions

    /**
     * The prefix of the names of the locks in their store (the locks of the applications sharing a store kept apart)
     */
    @Configurable(DTO.String().allow('').optional().default('lakutata:mutex:'))
    protected readonly prefix: string

    /**
     * Milliseconds a lock is held without renewal, 30 s by default
     */
    @Configurable(DTO.Number().integer().positive().optional().default(30000))
    protected readonly ttl: number

    /**
     * Milliseconds a lock is waited for, 10 s by default
     */
    @Configurable(DTO.Number().min(0).optional().default(10000))
    protected readonly timeout: number

    /**
     * Milliseconds between the first tries of a lock waited for (doubled up to one second)
     */
    @Configurable(DTO.Number().integer().positive().optional().default(50))
    protected readonly retryDelay: number

    #driver: MutexDriver

    readonly #held: Map<MutexLock, { timer?: NodeJS.Timeout, ttl: number, lock: DriverLock }> = new Map()

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const options: MutexDriverOptions = this.driver
        switch (options.type) {
            case 'file':
                this.#driver = new FileMutexDriver(options.directory ?? path.join(tmpdir(), 'lakutata-mutex'), this.prefix)
                break
            case 'redis':
                this.#driver = new RedisMutexDriver(options, this.prefix)
                break
            case 'postgres':
                this.#driver = new PostgresMutexDriver(options, this.prefix, options.mode, options.table)
                break
            case 'mysql':
                this.#driver = new MysqlMutexDriver(options, this.prefix, options.mode, options.table)
                break
            default:
                this.#driver = new MemoryMutexDriver(this.prefix)
        }
        //The locks of a connection closed
        this.#driver.onLost = (names: string[]): void => {
            for (const lock of [...this.#held.keys()]) if (names.includes(lock.name)) this.lost(lock, 'The connection holding the lock is closed')
        }
    }

    /**
     * Destroyer: the locks held released, the driver closed
     * @protected
     */
    protected async destroy(): Promise<void> {
        await Promise.allSettled([...this.#held.keys()].map((lock: MutexLock): Promise<boolean> => lock.release()))
        await this.#driver?.close()
    }

    /**
     * Lose a lock
     * @param lock
     * @param message
     * @protected
     */
    protected lost(lock: MutexLock, message: string): void {
        const held = this.#held.get(lock)
        clearInterval(held?.timer)
        this.#held.delete(lock)
        lock.lose(new MutexLostException(`The lock ${lock.name} is lost: ${message}`))
    }

    /**
     * Call the driver, its errors as the ones of the component
     * @param call
     * @protected
     */
    protected async call<T>(call: () => Promise<T>): Promise<T> {
        try {
            return await call()
        } catch (error: unknown) {
            if (error instanceof MutexDriverException || (error as { errno?: unknown })?.errno === 'E_MUTEX_DRIVER_NOT_FOUND') throw error
            throw new MutexDriverException(`The driver ${this.driver.type} of the locks failed: ${(error as Error)?.message ?? error}`)
        }
    }

    /**
     * Try to acquire a lock once
     * @param name
     * @param options
     */
    public async tryAcquire(name: string, options: Pick<MutexAcquireOptions, 'ttl'> = {}): Promise<MutexLock | undefined> {
        if (typeof name !== 'string' || !name) throw new TypeError('The name of a lock is a string which is not empty')
        const ttl: number = options.ttl ?? this.ttl
        const acquired: DriverLock | undefined = await this.call((): Promise<DriverLock | undefined> => this.#driver.acquire(name, ttl))
        if (!acquired) return undefined
        const lock: MutexLock = new MutexLock(name, acquired.token, acquired.fence, {
            release: async (target: MutexLock): Promise<boolean> => {
                const held = this.#held.get(target)
                clearInterval(held?.timer)
                this.#held.delete(target)
                return await this.call((): Promise<boolean> => this.#driver.release(name, acquired))
            },
            extend: async (target: MutexLock, next?: number): Promise<boolean> => {
                const held = this.#held.get(target)
                if (!held) return false
                if (next !== undefined) held.ttl = next
                const extended: boolean = await this.call((): Promise<boolean> => this.#driver.extend(name, acquired, held.ttl))
                if (!extended) this.lost(target, 'it expired before its renewal')
                return extended
            }
        })
        const held: { timer?: NodeJS.Timeout, ttl: number, lock: DriverLock } = {ttl: ttl, lock: acquired}
        //Renewed while it is held (a third of its time: renewed twice before it expires)
        if (this.#driver.expiring) {
            held.timer = setInterval((): void => {
                lock.extend().catch((error: Error): void => this.lost(lock, error.message))
            }, Math.max(10, Math.floor(held.ttl / 3)))
            held.timer.unref()
        }
        this.#held.set(lock, held)
        return lock
    }

    /**
     * Acquire a lock, waiting for its release by its holder up to the timeout
     * @param name
     * @param options
     */
    public async acquire(name: string, options: MutexAcquireOptions = {}): Promise<MutexLock> {
        const timeout: number = options.timeout ?? this.timeout
        const deadline: number = Date.now() + timeout
        let delay: number = this.retryDelay
        for (; ;) {
            options.signal?.throwIfAborted()
            const lock: MutexLock | undefined = await this.tryAcquire(name, options)
            if (lock) return lock
            const remaining: number = deadline - Date.now()
            if (remaining <= 0) throw new MutexTimeoutException(`The lock ${name} is not acquired in ${timeout} ms`)
            //Backed off up to a second, spread between the waiters
            try {
                await sleep(Math.min(remaining, delay * (0.5 + Math.random() / 2)), undefined, {signal: options.signal})
            } catch (error: unknown) {
                //The reason of its abort
                throw options.signal?.aborted ? options.signal.reason : error
            }
            delay = Math.min(delay * 2, 1000)
        }
    }

    /**
     * Run a function holding a lock: acquired before it, released after it (its errors too)
     * @param name
     * @param fn given the lock (its signal aborted once it is lost)
     * @param options
     */
    public async synchronized<T>(name: string, fn: (lock: MutexLock) => T | Promise<T>, options: MutexAcquireOptions = {}): Promise<T> {
        const lock: MutexLock = await this.acquire(name, options)
        try {
            return await fn(lock)
        } finally {
            await lock.release().catch((): undefined => undefined)
        }
    }

    /**
     * The locks this component holds
     */
    public get heldLocks(): MutexLock[] {
        return [...this.#held.keys()]
    }
}
