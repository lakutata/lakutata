/**
 * The handle of a database of the addon: an external value, given back to its functions
 * @internal
 */
export interface NativeDatabase {
    readonly __nativeDatabase: never
}

/**
 * The functions of the addon (native/addon.cc): each call of a database queues a task on its thread and gives the
 * promise of its result
 * @internal
 */
export interface NativeAddon {
    /**
     * A database: its thread started
     */
    open(): NativeDatabase

    /**
     * A round trip through the thread of a database: the bytes given back, after a delay in milliseconds
     */
    ping(database: NativeDatabase, bytes: Uint8Array, delay?: number): Promise<Buffer>

    /**
     * The closing of a database: the tasks queued run, then its thread ends; its calls after it are refused
     */
    close(database: NativeDatabase): Promise<void>
}
