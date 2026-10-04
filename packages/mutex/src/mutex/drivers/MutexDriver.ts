/**
 * A lock granted by a {@link MutexDriver}: what its holder gives back to release or renew it.
 */
export type DriverLock = {
    /**
     * The random token identifying the holder (32 hexadecimal characters); the store only releases or renews the lock
     * for it.
     */
    token: string
    /**
     * The fencing token: a number increasing with each acquisition in the store, given by the memory and Redis drivers
     * and the `table` mode of PostgreSQL and MySQL; `undefined` for the file driver and the advisory locks.
     */
    fence?: number
}

/**
 * The base class of the lock drivers: it acquires, releases and renews the locks in a store shared by their holders.
 * A {@link Mutex} creates its driver from its `driver` option and adds the waiting, the automatic renewal and the lost
 * locks; a custom subclass cannot be given to it. The drivers are exported to use a store directly (scripts, tests):
 * they neither wait nor renew, and their errors are the clients' errors, not a {@link MutexDriverException}.
 * @example
 * ```typescript
 * import {MemoryMutexDriver, type DriverLock, type MutexDriver} from 'lakutata/com/mutex'
 *
 * async function once(driver: MutexDriver, name: string, work: () => Promise<void>): Promise<boolean> {
 *     const lock: DriverLock | undefined = await driver.acquire(name, 10000)
 *     if (!lock) return false
 *     try {
 *         await work()
 *     } finally {
 *         await driver.release(name, lock)
 *     }
 *     return true
 * }
 *
 * const driver: MutexDriver = new MemoryMutexDriver('script:')
 * console.log(await once(driver, 'migrate', async (): Promise<void> => undefined))
 * await driver.close()
 * ```
 */
export abstract class MutexDriver {

    /**
     * Whether the locks expire after their `ttl` unless renewed: `true` for the memory, file and Redis drivers and the
     * `table` mode; `false` for the advisory locks of PostgreSQL and MySQL, which end with their connection instead.
     */
    public abstract readonly expiring: boolean

    /**
     * Called with the names of the locks the driver lost at once, when the connection holding advisory locks closes or
     * fails. A {@link Mutex} sets it; it does nothing by default.
     */
    public onLost: (names: string[]) => void = (): void => undefined

    /**
     * Try to acquire a lock once, without waiting.
     * @param name The lock name; the driver's prefix is added to it in the store.
     * @param ttl How long the lock stays held without a renewal, in milliseconds (ignored by the advisory locks).
     * @returns The lock granted, or `undefined` when another holder has it.
     * @throws {MutexDriverNotFoundException} When the client package of the driver is not installed.
     */
    public abstract acquire(name: string, ttl: number): Promise<DriverLock | undefined>

    /**
     * Release a lock, when the store still has it for this holder.
     * @param name The lock name, as acquired.
     * @param lock The lock returned by {@link MutexDriver.acquire}.
     * @returns Whether it was released: `false` when the store no longer has it for this holder (expired, taken, or its
     * connection closed).
     */
    public abstract release(name: string, lock: DriverLock): Promise<boolean>

    /**
     * Renew a lock for `ttl` milliseconds from now, when the store still has it for this holder; for the advisory locks,
     * check that it is still held.
     * @param name The lock name, as acquired.
     * @param lock The lock returned by {@link MutexDriver.acquire}.
     * @param ttl How long the lock stays held without another renewal, in milliseconds.
     * @returns Whether the lock is still held by this holder.
     */
    public abstract extend(name: string, lock: DriverLock, ttl: number): Promise<boolean>

    /**
     * Close the driver's connections; the advisory locks they hold are released by the database. The driver is not meant
     * to be used after it.
     */
    public abstract close(): Promise<void>
}
