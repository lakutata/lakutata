/**
 * The failed binds of a DN or an address
 */
export interface ThrottleState {
    /**
     * When the failures happened, in milliseconds since the epoch, the oldest first
     */
    failures: number[]
    /**
     * Until when the binds are refused
     */
    lockedUntil?: number
}

/**
 * Where the throttle keeps its states: in memory by default; a store shared by the instances of a server keeps them
 * together (the directory backend keeps them in its database)
 */
export interface ThrottleStore {
    /**
     * The state of a key
     * @param key The key.
     */
    get(key: string): Promise<ThrottleState | undefined> | ThrottleState | undefined
    /**
     * Keep the state of a key
     * @param key The key.
     * @param state The state.
     */
    set(key: string, state: ThrottleState): Promise<void> | void
    /**
     * Forget a key
     * @param key The key.
     */
    delete(key: string): Promise<void> | void
    /**
     * Change the state of a key at once, nothing else changing it between its read and its write: the failures of
     * binds made at once each counted. A store without it is read, then written: two failures at once may count as one.
     * @param key The key.
     * @param change The state made from the one kept (undefined forgets the key).
     */
    update?(key: string, change: (state: ThrottleState | undefined) => ThrottleState | undefined): Promise<void> | void
}

/**
 * The limits on failed binds: after `maxFailures` failures of a DN within `window` milliseconds (`ipMaxFailures` of an
 * address), its binds are refused for `lockout` milliseconds, with invalidCredentials like any failure; each failure
 * is answered later than the one before, by `delay` milliseconds more, up to `maxDelay`
 */
export interface BindThrottleOptions {
    /**
     * The failures of a DN that lock it (5 by default; 0 for no limit)
     */
    maxFailures?: number
    /**
     * The failures from an address that lock it (20 by default; 0 for no limit)
     */
    ipMaxFailures?: number
    /**
     * The milliseconds the failures are counted over (300000 by default)
     */
    window?: number
    /**
     * The milliseconds a DN or an address stays locked (300000 by default)
     */
    lockout?: number
    /**
     * The milliseconds each failure adds to the answer of the next (500 by default)
     */
    delay?: number
    /**
     * The longest delay of an answer, in milliseconds (3000 by default)
     */
    maxDelay?: number
    /**
     * Where the states are kept (in memory by default)
     */
    store?: ThrottleStore
}

/**
 * A store in memory, its states dropped once they no longer count
 */
export class MemoryThrottleStore implements ThrottleStore {
    protected readonly states: Map<string, ThrottleState> = new Map()

    public get(key: string): ThrottleState | undefined {
        return this.states.get(key)
    }

    public set(key: string, state: ThrottleState): void {
        //Bounded: the oldest key goes when there are too many
        if (this.states.size >= 100000 && !this.states.has(key)) this.states.delete(this.states.keys().next().value!)
        this.states.set(key, state)
    }

    public delete(key: string): void {
        this.states.delete(key)
    }

    public update(key: string, change: (state: ThrottleState | undefined) => ThrottleState | undefined): void {
        const next: ThrottleState | undefined = change(this.states.get(key))
        if (next) this.set(key, next)
        else this.delete(key)
    }
}

/**
 * The throttle of the binds of a server
 */
export class BindThrottle {
    protected readonly store: ThrottleStore

    constructor(protected readonly options: BindThrottleOptions = {}) {
        this.store = options.store ?? new MemoryThrottleStore()
    }

    /**
     * The limit of failures of a kind of key
     * @param key The key.
     */
    protected limit(key: string): number {
        return key.startsWith('ip:') ? this.options.ipMaxFailures ?? 20 : this.options.maxFailures ?? 5
    }

    /**
     * Whether a key is locked, and the delay to answer a failure of it
     * @param keys The keys of the bind (its DN and its address).
     * @param now The time.
     */
    public async check(keys: string[], now: number = Date.now()): Promise<{locked: boolean, delay: number}> {
        let locked: boolean = false
        let failures: number = 0
        for (const key of keys) {
            const state: ThrottleState | undefined = await this.store.get(key)
            if (!state) continue
            if (state.lockedUntil !== undefined && state.lockedUntil > now) locked = true
            failures = Math.max(failures, state.failures.filter((time: number): boolean => time > now - (this.options.window ?? 300000)).length)
        }
        return {locked: locked, delay: Math.min(failures * (this.options.delay ?? 500), this.options.maxDelay ?? 3000)}
    }

    /**
     * Count a failure of the keys of a bind
     * @param keys The keys.
     * @param now The time.
     */
    public async failure(keys: string[], now: number = Date.now()): Promise<void> {
        const window: number = this.options.window ?? 300000
        for (const key of keys) {
            const limit: number = this.limit(key)
            const failed = (kept: ThrottleState | undefined): ThrottleState => {
                const state: ThrottleState = kept ?? {failures: []}
                const failures: number[] = [...state.failures.filter((time: number): boolean => time > now - window), now].slice(-Math.max(limit, 1) - 1)
                const next: ThrottleState = {failures: failures}
                if (state.lockedUntil !== undefined && state.lockedUntil > now) next.lockedUntil = state.lockedUntil
                else if (limit > 0 && failures.length >= limit) next.lockedUntil = now + (this.options.lockout ?? 300000)
                return next
            }
            //At once where the store can: the failures of binds made at once each counted
            if (this.store.update) await this.store.update(key, failed)
            else await this.store.set(key, failed(await this.store.get(key)))
        }
    }

    /**
     * Forget the failures of the DN of a successful bind
     * @param key The key of its DN.
     */
    public async success(key: string): Promise<void> {
        await this.store.delete(key)
    }
}
