import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {FileCacheOptions} from '../options/FileCacheOptions.js'
import {Deserialize, Serialize} from '../lib/Serializer.js'

type FileRecord = {
    expire?: number
    value: string
}

type FileContent = {
    cache: [string, FileRecord][] | Record<string, FileRecord>
    lastExpire?: number
}

/**
 * The file store, the entries are kept in memory and written to the file in batches
 * File format: {"cache":[[key,{"expire":ms,"value":serialized entry}]],"lastExpire":ms}
 */
export class FileStore extends SerializedCacheStore {

    protected readonly filename: string

    protected readonly expiredCheckDelay: number

    protected readonly writeDelay: number

    protected records: Map<string, FileRecord> = new Map()

    protected lastExpire: number = Date.now()

    protected saveTimer?: NodeJS.Timeout

    protected saving: Promise<void> = Promise.resolve()

    constructor(options: FileCacheOptions) {
        super(options.namespace)
        this.filename = path.resolve(options.filename)
        this.expiredCheckDelay = options.expiredCheckDelay ?? 3600000
        this.writeDelay = options.writeDelay ?? 100
    }

    /**
     * Whether a record has expired
     * @param record
     * @protected
     */
    protected isExpired(record: FileRecord): boolean {
        return typeof record.expire === 'number' && record.expire <= Date.now()
    }

    /**
     * Remove the expired records, at most once in each expiredCheckDelay
     * @protected
     */
    protected removeExpired(): void {
        const now: number = Date.now()
        if (now - this.lastExpire <= this.expiredCheckDelay) return
        this.lastExpire = now
        for (const [key, record] of this.records) if (this.isExpired(record)) this.records.delete(key)
    }

    /**
     * Save the records after the write delay
     * @protected
     */
    protected scheduleSave(): void {
        if (this.saveTimer) return
        this.saveTimer = setTimeout((): void => {
            this.saveTimer = undefined
            this.saving = this.saving.then((): Promise<void> => this.save()).catch((error: Error): void => this.onError(error))
        }, this.writeDelay)
    }

    /**
     * Write the records to the file, through a temporary file
     * @protected
     */
    protected async save(): Promise<void> {
        this.removeExpired()
        const content: string = Serialize({cache: [...this.records], lastExpire: this.lastExpire})
        const temporary: string = `${this.filename}.${process.pid}.tmp`
        await mkdir(path.dirname(this.filename), {recursive: true})
        await writeFile(temporary, content)
        await rename(temporary, this.filename)
    }

    public async connect(): Promise<void> {
        let text: string
        try {
            text = await readFile(this.filename, 'utf8')
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
            throw e
        }
        const content: FileContent = Deserialize<FileContent>(text)
        this.records = new Map(Array.isArray(content.cache) ? content.cache : Object.entries(content.cache))
        if (typeof content.lastExpire === 'number') this.lastExpire = content.lastExpire
    }

    public async disconnect(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
            this.saveTimer = undefined
            this.saving = this.saving.then((): Promise<void> => this.save())
        }
        await this.saving
    }

    protected async read(key: string): Promise<string | undefined> {
        const record: FileRecord | undefined = this.records.get(key)
        if (record === undefined) return undefined
        if (this.isExpired(record)) {
            await this.remove(key)
            return undefined
        }
        return record.value
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        return Promise.all(keys.map((key: string): Promise<string | undefined> => this.read(key)))
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        this.records.set(entry.key, {expire: entry.expires, value: entry.data})
        this.scheduleSave()
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        for (const entry of entries) this.records.set(entry.key, {expire: entry.expires, value: entry.data})
        this.scheduleSave()
    }

    protected async remove(key: string): Promise<boolean> {
        if (!this.records.delete(key)) return false
        this.scheduleSave()
        return true
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        let removed: boolean = false
        for (const key of keys) removed = this.records.delete(key) || removed
        if (removed) this.scheduleSave()
        return removed
    }

    public async clear(): Promise<void> {
        if (this.namespace) {
            const prefix: string = `${this.namespace}:`
            for (const key of this.records.keys()) if (key.startsWith(prefix)) this.records.delete(key)
        } else {
            this.records.clear()
        }
        this.lastExpire = Date.now()
        this.scheduleSave()
    }
}
