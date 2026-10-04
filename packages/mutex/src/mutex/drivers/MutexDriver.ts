/**
 * A lock held through a driver: its token (its holder), its fencing token (increasing with each acquisition, when the
 * driver gives one)
 */
export type DriverLock = {
    token: string
    fence?: number
}

/**
 * A driver of the locks: their acquisition, their release and their renewal in a store shared by their holders
 */
export abstract class MutexDriver {

    /**
     * Whether its locks expire (their ttl, renewed while they are held); the locks of a connection (the advisory locks
     * of PostgreSQL and MySQL) end with it instead
     */
    public abstract readonly expiring: boolean

    /**
     * Run once locks are lost by the driver (the connection holding them closed)
     */
    public onLost: (names: string[]) => void = (): void => undefined

    /**
     * Acquire a lock once, undefined when another holder has it
     * @param name
     * @param ttl milliseconds, the time it is held without renewal
     */
    public abstract acquire(name: string, ttl: number): Promise<DriverLock | undefined>

    /**
     * Release a lock its holder has: false when it is not held by it any more
     * @param name
     * @param lock
     */
    public abstract release(name: string, lock: DriverLock): Promise<boolean>

    /**
     * Renew a lock its holder has: false when it is not held by it any more
     * @param name
     * @param lock
     * @param ttl
     */
    public abstract extend(name: string, lock: DriverLock, ttl: number): Promise<boolean>

    /**
     * Close the driver (its connections)
     */
    public abstract close(): Promise<void>
}
