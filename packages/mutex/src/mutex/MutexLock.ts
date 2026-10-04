/**
 * A lock acquired: its name, its token (its holder), its fencing token (increasing with each acquisition, when its
 * driver gives one); released once (await using releases it at the end of its scope)
 */
export class MutexLock implements AsyncDisposable {

    readonly #abort: AbortController = new AbortController()

    #held: boolean = true

    public readonly acquiredAt: Date = new Date()

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
     * Whether it is still held (not released, not lost)
     */
    public get held(): boolean {
        return this.#held
    }

    /**
     * Aborted once it is lost (expired before its renewal, its connection closed): the work it protects should stop
     */
    public get signal(): AbortSignal {
        return this.#abort.signal
    }

    /**
     * Release it (once: the next releases do nothing)
     * @return whether it was still held by its holder in its store
     */
    public async release(): Promise<boolean> {
        if (!this.#held) return false
        this.#held = false
        return await this.actions.release(this)
    }

    /**
     * Renew it now (the locks are renewed automatically while they are held)
     * @param ttl milliseconds, the one of its acquisition by default
     * @return whether it is still held
     */
    public async extend(ttl?: number): Promise<boolean> {
        if (!this.#held) return false
        return await this.actions.extend(this, ttl)
    }

    /**
     * Lose it (internal: its renewal failed, its connection closed)
     * @param reason
     */
    public lose(reason: Error): void {
        if (!this.#held) return
        this.#held = false
        this.#abort.abort(reason)
    }

    public async [Symbol.asyncDispose](): Promise<void> {
        await this.release()
    }
}
