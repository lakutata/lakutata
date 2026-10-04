import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {MongoCacheOptions} from '../options/MongoCacheOptions.js'
import {LoadDriver} from '../lib/LoadDriver.js'

type MongoDocument = {
    key: string
    value: string
    expiresAt?: Date | null
}

interface MongoCollection {
    createIndex(keys: Record<string, number>, options: Record<string, unknown>): Promise<unknown>

    findOne(filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<MongoDocument | null>

    find(filter: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<MongoDocument[]> }

    updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>

    bulkWrite(operations: Record<string, unknown>[], options: Record<string, unknown>): Promise<unknown>

    deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>

    deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>
}

interface MongoClient {
    connect(): Promise<unknown>

    close(): Promise<void>

    db(name: string): { collection(name: string): MongoCollection }
}

interface MongoDriver {
    MongoClient: new (url: string, options?: Record<string, unknown>) => MongoClient
}

/**
 * Escape the regular expression characters
 * @param text
 */
function EscapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The MongoDB store
 * Document format: {key: "{namespace}:{key}", value: serialized entry, expiresAt: Date | null}, removed by a TTL index
 */
export class MongoStore extends SerializedCacheStore {

    protected client: MongoClient

    protected collection: MongoCollection

    constructor(protected readonly options: MongoCacheOptions) {
        super(options.namespace)
    }

    public async connect(): Promise<void> {
        const driver: MongoDriver = await LoadDriver<MongoDriver>('MongoClient', 'mongodb')
        const options: MongoCacheOptions = this.options
        const auth: string = options.username ? `${encodeURIComponent(options.username)}:${encodeURIComponent(options.password ?? '')}@` : ''
        this.client = new driver.MongoClient(`mongodb://${auth}${options.host}:${options.port ?? 27017}`)
        await this.client.connect()
        this.collection = this.client.db(options.database).collection(options.collection)
        await this.collection.createIndex({key: 1}, {unique: true, background: true})
        await this.collection.createIndex({expiresAt: 1}, {expireAfterSeconds: 0, background: true})
    }

    public async disconnect(): Promise<void> {
        await this.client?.close()
    }

    protected async read(key: string): Promise<string | undefined> {
        const document: MongoDocument | null = await this.collection.findOne({key: {$eq: key}}, {projection: {_id: 0, value: 1}})
        return document ? document.value : undefined
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        const documents: MongoDocument[] = await this.collection.find({key: {$in: keys}}, {projection: {_id: 0, key: 1, value: 1}}).toArray()
        const values: Map<string, string> = new Map(documents.map((document: MongoDocument): [string, string] => [document.key, document.value]))
        return keys.map((key: string): string | undefined => values.get(key))
    }

    /**
     * The upsert of an entry
     * @param entry
     * @protected
     */
    protected update(entry: SerializedEntry): [Record<string, unknown>, Record<string, unknown>] {
        return [{key: {$eq: entry.key}}, {$set: {key: entry.key, value: entry.data, expiresAt: entry.expires ? new Date(entry.expires) : null}}]
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        const [filter, update] = this.update(entry)
        await this.collection.updateOne(filter, update, {upsert: true})
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        await this.collection.bulkWrite(entries.map((entry: SerializedEntry): Record<string, unknown> => {
            const [filter, update] = this.update(entry)
            return {updateOne: {filter: filter, update: update, upsert: true}}
        }), {ordered: false})
    }

    protected async remove(key: string): Promise<boolean> {
        return (await this.collection.deleteOne({key: {$eq: key}})).deletedCount > 0
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        return (await this.collection.deleteMany({key: {$in: keys}})).deletedCount > 0
    }

    public async clear(): Promise<void> {
        await this.collection.deleteMany(this.namespace ? {key: {$regex: `^${EscapeRegExp(this.namespace)}:`}} : {})
    }
}
