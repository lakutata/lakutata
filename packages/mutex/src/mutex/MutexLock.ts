/**
 * A lock held, returned by {@link Mutex.acquire} and {@link Mutex.tryAcquire} (and given to the function of
 * {@link Mutex.synchronized}); the component creates it. It stays held until it is released (once: the next releases do
 * nothing) or lost; the component renews it in the store meanwhile. Declared with `await using`, it is released at the
 * end of its scope.
 *
 * Its {@link MutexLock.signal} is aborted when it is lost: a renewal found it expired or taken by another holder, a
 * renewal failed, or the connection holding it closed. A lost lock is not released in the store: another holder may get
 * it once it expires. The work it protects should stop then, and the writes it makes may carry its
 * {@link MutexLock.fence} so that the store refuses the writes of an older holder.
 * @example
 * ```typescript
 * import type {Mutex, MutexLock} from 'lakutata/com/mutex'
 *
 * declare const mutex: Mutex
 * declare function writeReport(fence: number | undefined, signal: AbortSignal): Promise<void>
 *
 * await using lock: MutexLock = await mutex.acquire('report:daily')
 * lock.signal.addEventListener('abort', (): void => console.warn(`lost: ${lock.signal.reason}`))
 * await writeReport(lock.fence, lock.signal)
 * console.log(lock.held, Date.now() - lock.acquiredAt.getTime())
 * ```
 */
export class MutexLock implements AsyncDisposable {

    readonly #abort: AbortController = new AbortController()

    #held: boolean = true

    /**
     * When the lock was acquired (the time this object was created, once the store granted it).
     */
    public readonly acquiredAt: Date = new Date()

    /**
     * Create a held lock (the component does it, when the store grants a lock).
     * @param name The lock name, without the component's prefix.
     * @param token The random token identifying this holder in the store.
     * @param fence The fencing token given by the store, or `undefined` when the driver gives none.
     * @param actions How the component releases and renews the lock.
     */
    constructor(
        public readonly name: string,
        public readonly token: string,
        public readonly fence: number | undefined,
        protected readonly actions: {
            release: (lock: MutexLock) => Promise<boolean>
            extend: (lock: MutexLock, ttl?: number) => Promise<boolean>
        }
    ) {
    }

    /**
     * Whether the lock is still held: `false` once it is released or lost. It reflects what the component knows; an
     * expiring lock whose renewal is late may already be expired in the store.
     */
    public get held(): boolean {
        return this.#held
    }

    /**
     * Aborted when the lock is lost, with a {@link MutexLostException} as its reason: a renewal found it expired or taken,
     * a renewal failed, or the connection holding it closed. The work the lock protects should stop then. It is not
     * aborted by a release.
     */
    public get signal(): AbortSignal {
        return this.#abort.signal
    }

    /**
     * Release the lock in the store and stop its renewal. Only the first call releases it; the next ones, and the calls
     * on a lost lock, return `false` without reaching the store. The lock no longer counts as held even when the store
     * fails, in which case it stays in the store until it expires.
     * @returns Whether the store still had the lock for this holder (`false` when it had expired, been taken, or its
     * connection had closed).
     * @throws {MutexDriverException} When the store fails.
     */
    public async release(): Promise<boolean> {
        if (!this.#held) return false
        this.#held = false
        return await this.actions.release(this)
    }

    /**
     * Renew the lock now, for `ttl` milliseconds from now; the component already renews it automatically every third of
     * its `ttl`. A `ttl` given here is used by the next automatic renewals too, their interval following it. For the
     * advisory locks (which do not expire), it checks that the lock is still held by a query on its connection.
     * @param ttl How long the lock stays held without a renewal, in milliseconds; the lock's last `ttl` (the one of its
     * acquisition) by default.
     * @returns Whether the lock is still held; when the store no longer has it, the lock is marked lost (its signal
     * aborted) and `false` is returned.
     * @throws {MutexDriverException} When the store fails (the lock is not marked lost then).
     */
    public async extend(ttl?: number): Promise<boolean> {
        if (!this.#held) return false
        return await this.actions.extend(this, ttl)
    }

    /**
     * Mark the lock as lost and abort its signal with the reason; the component calls it when a renewal fails or the
     * connection holding the lock closes. It does nothing on a lock no longer held, and it does not release the lock in
     * the store nor stop its renewal: the applications do not call it.
     * @param reason The signal's abort reason, a {@link MutexLostException} from the component.
     */
    public lose(reason: Error): void {
        if (!this.#held) return
        this.#held = false
        this.#abort.abort(reason)
    }

    /**
     * Release the lock at the end of an `await using` scope, as {@link MutexLock.release} does.
     * @throws {MutexDriverException} When the store fails.
     */
    public async [Symbol.asyncDispose](): Promise<void> {
        await this.release()
    }
}
