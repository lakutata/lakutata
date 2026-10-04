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
 * The `driver` option of a {@link Mutex}: the store holding the locks, told apart by `type`. The store decides who
 * shares the locks: `'memory'` the components of one process, `'file'` the processes of one host, `'redis'`,
 * `'postgres'` and `'mysql'` every instance connected to the same server.
 */
export type MutexDriverOptions = MemoryMutexOptions | FileMutexOptions | RedisMutexOptions | PostgresMutexOptions | MysqlMutexOptions

/**
 * The options of {@link Mutex.acquire} and {@link Mutex.synchronized} ({@link Mutex.tryAcquire} only reads `ttl`).
 */
export type MutexAcquireOptions = {
    /**
     * How long the lock stays held without a renewal, in milliseconds. The component renews it every third of this time
     * while it is held, so it only expires when its holder is gone or cannot reach the store. Ignored by the PostgreSQL
     * and MySQL advisory locks, which end with their connection instead.
     * @default the component's `ttl` option (30000)
     */
    ttl?: number
    /**
     * How long to wait for the lock, in milliseconds: `0` tries once, `Infinity` waits until it is acquired. When the
     * time is up, the call rejects with {@link MutexTimeoutException}.
     * @default the component's `timeout` option (10000)
     */
    timeout?: number
    /**
     * Stops the wait when aborted: the call rejects with the signal's reason. An attempt already sent to the store is not
     * cancelled, and a lock it acquires is returned.
     * @default none (the wait only ends with the lock or the timeout)
     */
    signal?: AbortSignal
}

/**
 * A lock held by the component: its renewal timer, its time to live, its expiration as last renewed
 */
type HeldLock = {
    timer?: NodeJS.Timeout
    ttl: number
    lock: DriverLock
    expiresAt: number
}

/**
 * The lock component: named locks giving a work to one holder at a time, between the instances and the processes of an
 * application as its driver shares them (see {@link MutexDriverOptions}). Register it in the `components` of an
 * application (`{class: Mutex, driver: {...}}`, named `mutex` for `@Synchronized` and the `exclusive` schedules) and
 * get it with `getObject()` or `@Inject`; it is a singleton. Without a `driver`, the locks are in memory.
 *
 * A lock is acquired with a random token: only its holder ({@link MutexLock}) releases or renews it. The expiring
 * drivers (memory, file, Redis, the `table` mode of PostgreSQL and MySQL) hold it for its `ttl` and the component renews
 * it every third of that time, so a crashed holder keeps it at most one `ttl`. The advisory locks of PostgreSQL and
 * MySQL do not expire: the database releases them when the component's connection closes.
 *
 * A lock is lost when a renewal finds it expired or taken, when a renewal fails (the store unreachable), or when the
 * connection holding an advisory lock closes: its {@link MutexLock.signal} is then aborted with a
 * {@link MutexLostException}, and the work it protects should stop. The locks are not reentrant: acquiring a lock this
 * component already holds waits for its release like any other holder.
 *
 * The driver connects at its first use, not when the component is created: a store which cannot be reached, or whose
 * client package is missing, fails the first acquisition. The component releases the locks it holds and closes the
 * driver when it is destroyed (the application stopping).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Mutex, type MutexLock} from 'lakutata/com/mutex'
 *
 * Application
 *     .run(() => ({
 *         id: 'mutex.app',
 *         name: 'Mutex',
 *         components: {
 *             //The locks shared by every instance connected to this Redis server
 *             mutex: {class: Mutex, driver: {type: 'redis', url: 'redis://127.0.0.1:6379'}, ttl: 30000, timeout: 10000}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const mutex: Mutex = await app.getObject('mutex')
 *         //Acquired before the function, released after it, even when it throws
 *         const total: number = await mutex.synchronized('report:daily', async (lock: MutexLock): Promise<number> => {
 *             lock.signal.throwIfAborted()
 *             return 42
 *         })
 *         console.log(total)
 *     })
 * ```
 */
@Singleton()
export class Mutex extends Component {

    /**
     * The store holding the locks, told apart by `type`: `'memory'` (the components of one process), `'file'` (the
     * processes of one host), `'redis'`, `'postgres'` or `'mysql'` (every instance connected to the server).
     * @default {type: 'memory'}
     */
    @Configurable(DTO.Alternatives(MemoryMutexOptions.required(), FileMutexOptions.required(), RedisMutexOptions.required(), PostgresMutexOptions.required(), MysqlMutexOptions.required()).optional().default({type: 'memory'}))
    protected readonly driver: MutexDriverOptions

    /**
     * The prefix added to the lock names in the store, which keeps apart the applications sharing a store. Two
     * components with the same driver and prefix share their locks.
     * @default 'lakutata:mutex:'
     */
    @Configurable(DTO.String().allow('').optional().default('lakutata:mutex:'))
    protected readonly prefix: string

    /**
     * How long a lock stays held without a renewal, in milliseconds (a positive integer); the default of
     * {@link MutexAcquireOptions.ttl}.
     * @default 30000
     */
    @Configurable(DTO.Number().integer().positive().optional().default(30000))
    protected readonly ttl: number

    /**
     * How long {@link Mutex.acquire} waits for a lock, in milliseconds (`0` tries once, `Infinity` waits without limit);
     * the default of {@link MutexAcquireOptions.timeout}.
     * @default 10000
     */
    @Configurable(DTO.Number().min(0).optional().default(10000))
    protected readonly timeout: number

    /**
     * The delay before the second attempt to acquire a lock, in milliseconds. It doubles after each attempt up to one
     * second, each delay randomized between its half and its whole to spread the waiters.
     * @default 50
     */
    @Configurable(DTO.Number().integer().positive().optional().default(50))
    protected readonly retryDelay: number

    #driver: MutexDriver

    readonly #held: Map<MutexLock, HeldLock> = new Map()

    /**
     * Create the driver chosen by the `driver` option; it connects at its first use.
     * @throws {Error} When the `table` option of a PostgreSQL or MySQL driver is not a valid table name.
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
     * Release the locks this component holds (their failures ignored), then close the driver's connections.
     * @protected
     */
    protected async destroy(): Promise<void> {
        await Promise.allSettled([...this.#held.keys()].map((lock: MutexLock): Promise<boolean> => lock.release()))
        await this.#driver?.close()
    }

    /**
     * Mark a lock as lost: stop its renewal, forget it, and abort its signal with a {@link MutexLostException}. The lock
     * is not released in the store: it stays there until it expires (or its connection closes).
     * @param lock The lock lost.
     * @param message Why it is lost, added to the exception's message.
     * @protected
     */
    protected lost(lock: MutexLock, message: string): void {
        const held = this.#held.get(lock)
        clearTimeout(held?.timer)
        this.#held.delete(lock)
        lock.lose(new MutexLostException(`The lock ${lock.name} is lost: ${message}`))
    }

    /**
     * Call the driver, turning its errors into a {@link MutexDriverException} (a {@link MutexDriverNotFoundException} is
     * rethrown as it is).
     * @param call The driver call.
     * @returns What the driver call returns.
     * @throws {MutexDriverException} When the driver call fails.
     * @throws {MutexDriverNotFoundException} When the driver's client package is not installed.
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
     * Try to acquire a lock once, without waiting. The lock is renewed automatically while it is held (expiring
     * drivers), until it is released or lost.
     * @param name The lock name, a non-empty string; the component's `prefix` is added to it in the store.
     * @param options `ttl`: how long the lock stays held without a renewal, in milliseconds (the component's `ttl` by
     * default).
     * @returns The lock, or `undefined` when another holder has it (this component included: the locks are not
     * reentrant).
     * @throws {TypeError} When the name is not a non-empty string.
     * @throws {MutexDriverException} When the store fails (unreachable, a failed query).
     * @throws {MutexDriverNotFoundException} When the driver's client package (`redis`, `pg`, `mysql2`) is not installed.
     * @example
     * ```typescript
     * import type {Mutex, MutexLock} from 'lakutata/com/mutex'
     *
     * declare const mutex: Mutex
     *
     * //A cleanup run by whichever instance gets there first, skipped by the others
     * const lock: MutexLock | undefined = await mutex.tryAcquire('cleanup')
     * if (lock) {
     *     try {
     *         console.log('cleaning up')
     *     } finally {
     *         await lock.release()
     *     }
     * }
     * ```
     */
    public async tryAcquire(name: string, options: Pick<MutexAcquireOptions, 'ttl'> = {}): Promise<MutexLock | undefined> {
        if (typeof name !== 'string' || !name) throw new TypeError('The name of a lock is a string which is not empty')
        const ttl: number = options.ttl ?? this.ttl
        const startedAt: number = Date.now()
        const acquired: DriverLock | undefined = await this.call((): Promise<DriverLock | undefined> => this.#driver.acquire(name, ttl))
        if (!acquired) return undefined
        const lock: MutexLock = new MutexLock(name, acquired.token, acquired.fence, {
            release: async (target: MutexLock): Promise<boolean> => {
                const held = this.#held.get(target)
                clearTimeout(held?.timer)
                this.#held.delete(target)
                return await this.call((): Promise<boolean> => this.#driver.release(name, acquired))
            },
            extend: async (target: MutexLock, next?: number): Promise<boolean> => {
                const held: HeldLock | undefined = this.#held.get(target)
                if (!held) return false
                if (next !== undefined) held.ttl = next
                const renewedAt: number = Date.now()
                const extended: boolean = await this.call((): Promise<boolean> => this.#driver.extend(name, acquired, held.ttl))
                if (!extended) {
                    this.lost(target, 'it expired before its renewal')
                    return false
                }
                held.expiresAt = renewedAt + held.ttl
                //The next renewal follows its new time to live
                this.renew(target)
                return true
            }
        })
        this.#held.set(lock, {ttl: ttl, lock: acquired, expiresAt: startedAt + ttl})
        this.renew(lock)
        return lock
    }

    /**
     * Plan the next renewal of a lock of an expiring driver: a third of its time to live (renewed twice before it
     * expires). A renewal failing (the store unreachable) is tried again until the lock expires, then the lock is lost
     * @param lock
     * @protected
     */
    protected renew(lock: MutexLock): void {
        const held: HeldLock | undefined = this.#held.get(lock)
        if (!held || !this.#driver.expiring) return
        clearTimeout(held.timer)
        held.timer = setTimeout((): void => {
            lock.extend().catch((error: Error): void => {
                if (!this.#held.has(lock)) return
                if (Date.now() >= held.expiresAt) return this.lost(lock, error.message)
                //Tried again before it expires
                this.renew(lock)
            })
        }, Math.max(10, Math.floor(held.ttl / 3)))
        held.timer.unref()
    }

    /**
     * An attempt of {@link Mutex.acquire}, bounded by its deadline: an attempt hanging (the store unreachable) fails at
     * the deadline, the lock it acquires later released
     * @param name
     * @param options
     * @param deadline
     * @param timeout
     * @protected
     */
    protected async attempt(name: string, options: MutexAcquireOptions, deadline: number, timeout: number): Promise<MutexLock | undefined> {
        const attempt: Promise<MutexLock | undefined> = this.tryAcquire(name, options)
        let timer: NodeJS.Timeout | undefined
        const expired: Promise<'expired'> = new Promise((resolve: (value: 'expired') => void): void => {
            timer = setTimeout((): void => resolve('expired'), Math.max(0, deadline - Date.now()))
        })
        try {
            const result: MutexLock | undefined | 'expired' = await Promise.race([attempt, expired])
            if (result !== 'expired') return result
        } finally {
            clearTimeout(timer)
        }
        //Too late: a lock acquired after the deadline is released
        attempt.then((late: MutexLock | undefined): unknown => late?.release(), (): undefined => undefined)
        throw new MutexTimeoutException(`The lock ${name} is not acquired in ${timeout} ms`)
    }

    /**
     * Acquire a lock, waiting up to the timeout for its holder to release it (or for it to expire). The store is polled:
     * the first retry comes after `retryDelay` milliseconds, the delay doubling up to one second. The lock is renewed
     * automatically while it is held, until it is released or lost; release it with {@link MutexLock.release}, or
     * declare it with `await using`.
     * @param name The lock name, a non-empty string; the component's `prefix` is added to it in the store.
     * @param options The lock's `ttl`, the `timeout` of the wait and an abort `signal` (the component's options by
     * default).
     * @returns The lock acquired.
     * @throws {MutexTimeoutException} When the lock is not acquired before the timeout (a `timeout` of `0` after one
     * attempt).
     * @throws {TypeError} When the name is not a non-empty string.
     * @throws {MutexDriverException} When the store fails; the wait stops at the first failure.
     * @throws {MutexDriverNotFoundException} When the driver's client package is not installed.
     * @throws The signal's reason (an `AbortError` `DOMException` by default) when the signal is aborted before the lock
     * is acquired.
     * @example
     * ```typescript
     * import type {Mutex, MutexLock} from 'lakutata/com/mutex'
     *
     * declare const mutex: Mutex
     *
     * //Waits up to 3 seconds, then rejects with MutexTimeoutException
     * const lock: MutexLock = await mutex.acquire('order:42', {timeout: 3000})
     * try {
     *     console.log(`order 42 is ours, fencing token ${lock.fence}`)
     * } finally {
     *     await lock.release()
     * }
     *
     * //Released at the end of the block, even when it throws
     * {
     *     await using scoped: MutexLock = await mutex.acquire('order:43', {signal: AbortSignal.timeout(5000)})
     *     console.log(scoped.name)
     * }
     * ```
     */
    public async acquire(name: string, options: MutexAcquireOptions = {}): Promise<MutexLock> {
        const timeout: number = options.timeout ?? this.timeout
        const deadline: number = Date.now() + timeout
        let delay: number = this.retryDelay
        for (; ;) {
            options.signal?.throwIfAborted()
            const lock: MutexLock | undefined = await this.attempt(name, options, deadline, timeout)
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
     * Run a function holding a lock: acquire it as {@link Mutex.acquire} does, run the function, then release the lock
     * whether the function returned or threw (a failure of the release is ignored). When the lock is lost while the
     * function runs, the function is not interrupted: its `lock.signal` is aborted, and it should check it.
     * @param name The lock name, a non-empty string; the component's `prefix` is added to it in the store.
     * @param fn The function to run, given the lock.
     * @param options The lock's `ttl`, the `timeout` of the wait and an abort `signal` (the component's options by
     * default).
     * @returns What the function returns (awaited).
     * @throws {MutexTimeoutException} When the lock is not acquired before the timeout; the function does not run.
     * @throws {MutexDriverException} When the store fails while acquiring the lock.
     * @throws {MutexDriverNotFoundException} When the driver's client package is not installed.
     * @throws The function's error, after the lock is released.
     * @example
     * ```typescript
     * import type {Mutex, MutexLock} from 'lakutata/com/mutex'
     *
     * declare const mutex: Mutex
     * declare function chargeOrder(id: number, signal: AbortSignal): Promise<string>
     *
     * //One payment of order 42 at a time, in every instance sharing the store
     * const receipt: string = await mutex.synchronized('order:42', (lock: MutexLock): Promise<string> => {
     *     //Aborted with a MutexLostException when the lock is lost
     *     return chargeOrder(42, lock.signal)
     * }, {timeout: 5000})
     * console.log(receipt)
     * ```
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
     * The locks this component holds now (not released, not lost), in their acquisition order; a new array on each read.
     */
    public get heldLocks(): MutexLock[] {
        return [...this.#held.keys()]
    }
}
