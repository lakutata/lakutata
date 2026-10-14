import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { TypeORMError } from "../../error/TypeORMError"
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
}

/**
 * lakutata: the extension of the files of the collections.
 */
const EXTENSION = ".log"

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

    protected constructor(
        readonly directory: string | undefined,
        readonly values: EmbeddedValues,
        readonly options: EmbeddedStoreOptions,
    ) {}

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
                    file,
                )
                if (collection)
                    store.collections.set(collection.name, collection)
                else fs.rmSync(file, { force: true })
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
        if (collection.file instanceof EmbeddedDiskFile)
            fs.rmSync(collection.file.path, { force: true })
        return true
    }

    /**
     * Removes all the collections.
     */
    clear(): void {
        for (const name of this.names()) this.drop(name)
    }

    /**
     * Closes the database: its files written to the disk and closed, its directory unlocked.
     */
    async close(): Promise<void> {
        if (this.timer) clearTimeout(this.timer)
        this.timer = undefined
        try {
            if (this.directory)
                for (const collection of this.collections.values())
                    this.unsynced.add(collection.file)
            this.sync()
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
