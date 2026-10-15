import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { TypeORMError } from "../../error/TypeORMError"
import { EmbeddedCacheBudget, EmbeddedCollectionCache } from "./EmbeddedCache"
import { EmbeddedCollectionStore } from "./EmbeddedCollectionStore"
import type { EmbeddedFile } from "./EmbeddedFile"
import { EmbeddedDiskFile, EmbeddedMemoryFile } from "./EmbeddedFile"
import type { EmbeddedValues } from "./EmbeddedValues"

/**
 * lakutata: when the writes are written to the disk (fsync): after each write ("always", the writes made together
 * sharing one), every interval ("interval"), or when the system does ("never").
 */
export type EmbeddedSync = "always" | "interval" | "never"

/**
 * lakutata: the options of the storage of an embedded MongoDB.
 */
export interface EmbeddedStoreOptions {
    sync?: EmbeddedSync
    syncInterval?: number
    cacheSize?: number
    compaction?: false | { minimumSize?: number; ratio?: number }
}

/**
 * lakutata: the extension of the files of the collections.
 */
const EXTENSION = ".log"

/**
 * lakutata: the extension added to the file of a collection for the file of its compaction.
 */
const NEXT = ".next"

/**
 * lakutata: yields the event loop.
 */
function yieldLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve))
}

/**
 * lakutata: the path of the snapshot of the file of a collection.
 *
 * @param file
 */
function snapshotOf(file: string): string {
    return file.slice(0, -EXTENSION.length) + ".snapshot"
}

/**
 * lakutata: the name of the file of a collection: its name (the characters of the names of files) and the hash of
 * it (the names differing by their case, on the systems ignoring it).
 *
 * @param name
 */
function fileNameOf(name: string): string {
    const safe = name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64)
    const hash = createHash("sha1").update(name).digest("hex").slice(0, 8)
    return `${safe}.${hash}${EXTENSION}`
}

/**
 * lakutata: whether a process runs.
 *
 * @param pid
 */
function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error.code === "EPERM"
    }
}

/**
 * lakutata: the collections of an embedded MongoDB: the files of a directory (created when missing, locked by the
 * process which opens it), or files in memory (":memory:").
 */
export class EmbeddedStore {
    protected readonly collections = new Map<string, EmbeddedCollectionStore>()

    protected readonly unsynced = new Set<EmbeddedFile>()

    protected waiting: { resolve: () => void; reject: (error: Error) => void }[] =
        []

    protected syncScheduled = false

    protected timer?: ReturnType<typeof setTimeout>

    /**
     * Whether it is closing or closed: the writes made then are synced by the closing.
     */
    protected closing = false

    protected readonly budget: EmbeddedCacheBudget

    protected constructor(
        readonly directory: string | undefined,
        readonly values: EmbeddedValues,
        readonly options: EmbeddedStoreOptions,
    ) {
        this.budget = new EmbeddedCacheBudget(
            options.cacheSize ?? 64 * 1024 * 1024,
        )
    }

    /**
     * Opens a database: its directory locked, the files of its collections read.
     *
     * @param directory the directory of the database, or undefined for a database in memory
     * @param values
     * @param options
     */
    static open(
        directory: string | undefined,
        values: EmbeddedValues,
        options: EmbeddedStoreOptions,
    ): EmbeddedStore {
        const store = new EmbeddedStore(directory, values, options)
        if (!directory) return store
        fs.mkdirSync(directory, { recursive: true })
        store.lock()
        try {
            for (const name of fs.readdirSync(directory)) {
                if (!name.endsWith(EXTENSION)) continue
                const file = path.join(directory, name)
                const collection = EmbeddedCollectionStore.open(
                    new EmbeddedDiskFile(file),
                    values,
                    new EmbeddedCollectionCache(store.budget),
                    file,
                    snapshotOf(file),
                )
                if (collection) {
                    store.collections.set(collection.name, collection)
                    store.resumeCompaction(collection, file)
                } else {
                    fs.rmSync(file, { force: true })
                    fs.rmSync(snapshotOf(file), { force: true })
                    fs.rmSync(file + NEXT, { force: true })
                }
            }
        } catch (error) {
            store.closeFiles()
            store.unlock()
            throw error
        }
        return store
    }

    /**
     * The names of the collections.
     */
    names(): string[] {
        return [...this.collections.keys()]
    }

    /**
     * A collection, created when asked.
     *
     * @param name
     * @param create
     */
    collection(
        name: string,
        create: boolean,
    ): EmbeddedCollectionStore | undefined {
        let collection = this.collections.get(name)
        if (!collection && create) {
            collection = EmbeddedCollectionStore.create(
                name,
                this.directory
                    ? new EmbeddedDiskFile(
                          path.join(this.directory, fileNameOf(name)),
                      )
                    : new EmbeddedMemoryFile(),
                this.values,
                new EmbeddedCollectionCache(this.budget),
            )
            this.collections.set(name, collection)
        }
        return collection
    }

    /**
     * After a write of a collection: resolved once it is written as the option sync tells.
     *
     * @param collection
     */
    written(collection: EmbeddedCollectionStore): Promise<void> {
        if (this.closing) return Promise.resolve()
        this.compactIfWorth(collection)
        if (!this.directory || this.options.sync === "never")
            return Promise.resolve()
        this.unsynced.add(collection.file)
        if (this.options.sync === "always")
            return new Promise((resolve, reject) => {
                this.waiting.push({ resolve: resolve, reject: reject })
                if (this.syncScheduled) return
                this.syncScheduled = true
                setImmediate(() => {
                    try {
                        this.sync()
                    } catch {
                        // the writes waiting for it are rejected
                    }
                })
            })
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.timer = undefined
                try {
                    this.sync()
                } catch {
                    // the next write or the closing syncs again
                }
            }, this.options.syncInterval ?? 100)
            this.timer.unref?.()
        }
        return Promise.resolve()
    }

    /**
     * Removes a collection and its file; whether it existed.
     *
     * @param name
     */
    drop(name: string): boolean {
        const collection = this.collections.get(name)
        if (!collection) return false
        this.collections.delete(name)
        this.unsynced.delete(collection.file)
        collection.close()
        if (collection.file instanceof EmbeddedDiskFile) {
            fs.rmSync(collection.file.path, { force: true })
            fs.rmSync(snapshotOf(collection.file.path), { force: true })
        }
        return true
    }

    /**
     * Removes all the collections.
     */
    clear(): void {
        for (const name of this.names()) this.drop(name)
    }

    /**
     * Closes the database: its files written to the disk, the snapshots of the collections changed written (a
     * snapshot failing to be written is left as it was: the records written after it are read again), its files
     * closed, its directory unlocked.
     */
    async close(): Promise<void> {
        this.closing = true
        if (this.timer) clearTimeout(this.timer)
        this.timer = undefined
        for (const collection of this.collections.values()) {
            await collection.building
            await collection.compacting
        }
        try {
            if (this.directory)
                for (const collection of this.collections.values())
                    this.unsynced.add(collection.file)
            this.sync()
            for (const collection of this.collections.values())
                if (
                    collection.changed &&
                    !collection.previous &&
                    collection.file instanceof EmbeddedDiskFile
                ) {
                    const snapshot = snapshotOf(collection.file.path)
                    try {
                        collection.writeSnapshot(snapshot)
                    } catch {
                        fs.rmSync(`${snapshot}.tmp`, { force: true })
                    }
                }
        } finally {
            this.closeFiles()
            this.unlock()
        }
    }

    /**
     * Writes the files written to the disk, and resolves the writes waiting for it.
     */
    protected sync(): void {
        this.syncScheduled = false
        const waiting = this.waiting
        this.waiting = []
        try {
            for (const file of this.unsynced) file.sync()
            this.unsynced.clear()
        } catch (error) {
            for (const write of waiting) write.reject(error)
            throw error
        }
        for (const write of waiting) write.resolve()
    }

    /**
     * Starts the compaction of a collection when its file is worth it (and none runs).
     *
     * @param collection
     */
    protected compactIfWorth(collection: EmbeddedCollectionStore): void {
        const options = this.options.compaction
        if (options === false || collection.compacting) return
        if (
            !collection.isWorthCompacting(
                options?.minimumSize ?? 16 * 1024 * 1024,
                options?.ratio ?? 2,
            )
        )
            return
        collection.compacting = this.compact(collection).finally(() => {
            collection.compacting = undefined
        })
    }

    /**
     * Compacts a collection: its live documents copied to a new file, a batch between two yields of the event loop,
     * the writes made meanwhile written to it; then the new file written to the disk and renamed over the previous
     * one. A compaction failing leaves the collection on its two files (the next opening resumes it).
     *
     * @param collection
     */
    protected async compact(collection: EmbeddedCollectionStore): Promise<void> {
        collection.beginCompaction(
            collection.file instanceof EmbeddedDiskFile
                ? new EmbeddedDiskFile(collection.file.path + NEXT)
                : new EmbeddedMemoryFile(),
        )
        try {
            for (const _ of collection.copyLiveDocuments()) await yieldLoop()
            this.endCompaction(collection)
        } catch {
            // Its two files are read until the next opening resumes it
        }
    }

    /**
     * Ends the compaction of a collection: the new file written to the disk, the previous one closed, the new one
     * renamed over it (its snapshot removed: it is the one of the previous file).
     *
     * @param collection
     */
    protected endCompaction(collection: EmbeddedCollectionStore): void {
        const next = collection.file
        if (!(next instanceof EmbeddedDiskFile)) {
            collection.endCompaction()
            return
        }
        const previous = collection.previous as EmbeddedDiskFile
        const path = previous.path
        next.sync()
        // The writes of the previous file not synced yet: the new file, synced, holds them
        this.unsynced.delete(previous)
        collection.endCompaction()
        fs.renameSync(next.path, path)
        next.path = path
        fs.rmSync(snapshotOf(path), { force: true })
        this.unsynced.add(next)
    }

    /**
     * Resumes the compaction of a collection cut by a crash, when its file is there (a file cut when it was created is
     * removed).
     *
     * @param collection
     * @param file the path of the file of the collection
     */
    protected resumeCompaction(
        collection: EmbeddedCollectionStore,
        file: string,
    ): void {
        if (!fs.existsSync(file + NEXT)) return
        const next = new EmbeddedDiskFile(file + NEXT)
        try {
            collection.resumeCompaction(next, file + NEXT)
        } catch (error) {
            if (collection.file === next) throw error
            // Its header cut: nothing was written to it
            next.close()
            fs.rmSync(file + NEXT, { force: true })
            return
        }
        this.endCompaction(collection)
    }

    protected closeFiles(): void {
        for (const collection of this.collections.values()) collection.close()
        this.collections.clear()
    }

    /**
     * Locks the directory: its file LOCK holds the pid of the process, removed when it does not run any more.
     */
    protected lock(): void {
        const lock = path.join(this.directory!, "LOCK")
        for (let attempt = 0; ; attempt++) {
            try {
                const descriptor = fs.openSync(lock, "wx")
                fs.writeSync(descriptor, String(process.pid))
                fs.closeSync(descriptor)
                return
            } catch (error) {
                if (error.code !== "EEXIST" || attempt > 0) throw error
                const pid = Number(fs.readFileSync(lock, "utf8"))
                if (pid && isRunning(pid))
                    throw new TypeORMError(
                        `The database ${this.directory} of mongo-embedded is opened by ${pid === process.pid ? "this process" : `the process ${pid}`}`,
                    )
                fs.rmSync(lock, { force: true })
            }
        }
    }

    protected unlock(): void {
        if (this.directory)
            fs.rmSync(path.join(this.directory, "LOCK"), { force: true })
    }
}
