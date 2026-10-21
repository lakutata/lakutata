import type * as IORedis from 'ioredis'
import type {Redis, RedisOptions} from 'ioredis'
import type {ClusterRedisTransportOptions} from '../Cluster.js'
import type {ClusterTransport} from './ClusterTransport.js'
import {loadClient} from './LoadClient.js'

/**
 * The bus on a Redis server: its channels (publish and subscribe), on two connections
 */
export class RedisClusterTransport implements ClusterTransport {

    //Larger messages in parts: a subscriber whose output buffer grows past 32 MiB is disconnected by the server
    public readonly maxPayload: number = 1024 * 1024

    readonly #handlers: Map<string, (data: Uint8Array) => void> = new Map()

    readonly #reconnectListeners: (() => void)[] = []

    #publisher: Redis

    #subscriber: Redis

    constructor(protected readonly options: Omit<ClusterRedisTransportOptions, 'type'>) {
    }

    public async connect(): Promise<void> {
        const {Redis: Client} = await loadClient<typeof IORedis>('Redis', 'ioredis')
        const options: RedisOptions = {
            db: this.options.database,
            username: this.options.username,
            password: this.options.password,
            //Connected below: a server unreachable when the component starts fails it
            lazyConnect: true
        }
        const publisher: Redis = this.options.url
            ? new Client(this.options.url, options)
            : new Client({...options, host: this.options.host ?? '127.0.0.1', port: this.options.port ?? 6379, tls: this.options.tls ? {} : undefined})
        await this.connected(publisher)
        const subscriber: Redis = publisher.duplicate()
        await this.connected(subscriber)
        subscriber.on('messageBuffer', (channel: Buffer, message: Buffer): void => this.#handlers.get(channel.toString())?.(message))
        //Its first ready is the connection above; the next ones come after it was lost (the channels subscribed again)
        subscriber.on('ready', (): void => this.#reconnectListeners.forEach((listener: () => void): void => listener()))
        this.#publisher = publisher
        this.#subscriber = subscriber
    }

    public publish(subject: string, data: Uint8Array): void {
        this.#publisher.publish(subject, Buffer.from(data.buffer, data.byteOffset, data.byteLength)).catch((): void => undefined)
    }

    public async subscribe(subject: string, handler: (data: Uint8Array) => void): Promise<void> {
        this.#handlers.set(subject, handler)
        await this.#subscriber.subscribe(subject)
    }

    public onReconnect(listener: () => void): void {
        this.#reconnectListeners.push(listener)
    }

    public async close(): Promise<void> {
        await Promise.allSettled([this.#subscriber, this.#publisher].filter((client: Redis | undefined): boolean => !!client).map((client: Redis): Promise<'OK'> => client.quit()))
    }

    /**
     * Connect a client, failing with the reason when the server cannot be reached; afterwards, it reconnects by itself
     * @param client
     * @protected
     */
    protected async connected(client: Redis): Promise<void> {
        let failure: Error | undefined
        const remember = (error: Error): void => {
            failure = error
        }
        client.on('error', remember)
        try {
            await client.connect()
        } catch (error) {
            client.disconnect()
            //The error of the connection tells why (the rejection only that it is closed)
            throw new Error(`The Redis server of the cluster cannot be reached: ${(failure ?? error as Error).message}`, {cause: error})
        }
        client.off('error', remember)
        client.on('error', (): void => undefined)
    }
}
