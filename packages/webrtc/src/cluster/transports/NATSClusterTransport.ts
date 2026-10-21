import type * as Nats from 'nats'
import type {Msg, NatsConnection, NatsError, Status} from 'nats'
import type {ClusterNATSTransportOptions} from '../Cluster.js'
import type {ClusterTransport} from './ClusterTransport.js'
import {loadClient} from './LoadClient.js'

/**
 * The bus on a NATS server: its core subjects (no JetStream)
 */
export class NATSClusterTransport implements ClusterTransport {

    public maxPayload: number = 1024 * 1024

    readonly #reconnectListeners: (() => void)[] = []

    #connection: NatsConnection

    constructor(protected readonly options: Omit<ClusterNATSTransportOptions, 'type'>) {
    }

    public async connect(): Promise<void> {
        const nats: typeof Nats = await loadClient<typeof Nats>('connect', 'nats')
        this.#connection = await nats.connect({
            servers: this.options.servers ?? '127.0.0.1:4222',
            user: this.options.user,
            pass: this.options.pass,
            token: this.options.token,
            name: this.options.name,
            //A node of a cluster waits for its server as long as it runs
            maxReconnectAttempts: -1
        })
        this.maxPayload = this.#connection.info?.max_payload ?? this.maxPayload
        void this.watch(this.#connection)
    }

    public publish(subject: string, data: Uint8Array): void {
        if (this.#connection.isClosed()) return
        try {
            this.#connection.publish(subject, data)
        } catch {
            //Lost, as when the server cannot be reached
        }
    }

    public async subscribe(subject: string, handler: (data: Uint8Array) => void): Promise<void> {
        this.#connection.subscribe(subject, {
            callback: (error: NatsError | null, message: Msg): void => {
                if (!error) handler(message.data)
            }
        })
        await this.#connection.flush()
    }

    public onReconnect(listener: () => void): void {
        this.#reconnectListeners.push(listener)
    }

    public async close(): Promise<void> {
        if (!this.#connection || this.#connection.isClosed()) return
        await this.#connection.flush().catch((): void => undefined)
        await this.#connection.close()
    }

    /**
     * Tell the listeners when the connection comes back
     * @param connection
     * @protected
     */
    protected async watch(connection: NatsConnection): Promise<void> {
        for await (const status of connection.status() as AsyncIterable<Status>) {
            if (status.type === 'reconnect') this.#reconnectListeners.forEach((listener: () => void): void => listener())
        }
    }
}
