import {hostname} from 'node:os'
import {randomBytes, randomUUID} from 'node:crypto'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {ClusterRequestException} from '../exceptions/ClusterRequestException.js'
import {ClusterTimeoutException} from '../exceptions/ClusterTimeoutException.js'
import {FrameAssembler, framesOf} from './ClusterFrames.js'
import type {ClusterTransport} from './transports/ClusterTransport.js'
import {MemoryClusterTransport} from './transports/MemoryClusterTransport.js'
import {NATSClusterTransport} from './transports/NATSClusterTransport.js'
import {RedisClusterTransport} from './transports/RedisClusterTransport.js'

/**
 * The bus in the memory of the process: the clusters of the same `prefix` in one process reach each other (the
 * applications of a test). It needs no server and no package.
 */
export interface ClusterMemoryTransportOptions {
    /**
     * `'memory'`.
     */
    type: 'memory'
}

/**
 * The bus on a NATS server (its core subjects, without JetStream). It needs the optional peer dependency `nats`
 * (`npm install nats`, the client of `@lakutata/nats`).
 */
export interface ClusterNATSTransportOptions {
    /**
     * `'nats'`.
     */
    type: 'nats'
    /**
     * The server URLs (`nats://host:4222`).
     * @default 'nats://127.0.0.1:4222'
     */
    servers?: string | string[]
    /**
     * The user name.
     * @default none
     */
    user?: string
    /**
     * The password.
     * @default none
     */
    pass?: string
    /**
     * The authentication token.
     * @default none
     */
    token?: string
    /**
     * The name of the connection, shown by the server.
     * @default none
     */
    name?: string
}

/**
 * The bus on a Redis server (its channels: publish and subscribe). It needs the optional peer dependency `ioredis`
 * (`npm install ioredis`).
 */
export interface ClusterRedisTransportOptions {
    /**
     * `'redis'`.
     */
    type: 'redis'
    /**
     * The server URL (`redis://user:password@host:6379/0`, `rediss://` for TLS). When set, `host`, `port` and `tls` are
     * ignored; `username`, `password` and `database` apply when the URL does not give them.
     * @default none
     */
    url?: string
    /**
     * The host name or IP address of the server (without a `url`).
     * @default '127.0.0.1'
     */
    host?: string
    /**
     * The port of the server (without a `url`).
     * @default 6379
     */
    port?: number
    /**
     * The database number.
     * @default 0
     */
    database?: number
    /**
     * The user name (Redis 6 ACL).
     * @default none
     */
    username?: string
    /**
     * The password.
     * @default none
     */
    password?: string
    /**
     * Connect with TLS (without a `url`).
     * @default false
     */
    tls?: boolean
}

/**
 * The bus of a {@link Cluster}: in the memory of the process, on a NATS server or on a Redis server.
 */
export type ClusterTransportOptions = ClusterMemoryTransportOptions | ClusterNATSTransportOptions | ClusterRedisTransportOptions

/**
 * The options of a {@link Cluster} (see {@link buildClusterOptions}).
 */
export interface ClusterOptions {
    /**
     * The bus the nodes talk through: `{type: 'nats', servers}`, `{type: 'redis', url}`, or `{type: 'memory'}` for the
     * applications of one process.
     */
    transport: ClusterTransportOptions
    /**
     * The prefix of the subjects (NATS) or channels (Redis): the clusters sharing a server stay separate with it.
     * Letters, digits, `_` and `-`, in tokens separated by dots.
     * @default 'lakutata.webrtc'
     */
    prefix?: string
    /**
     * The id of this node, unique in the cluster: letters, digits, `_` and `-`, 128 at most.
     * @default the host name (the name of the pod in Kubernetes) and a random suffix
     */
    nodeId?: string
    /**
     * The labels of this node, which the other nodes see (a zone, a region).
     * @default {}
     */
    labels?: Record<string, string>
    /**
     * How often this node tells the others it is there, in milliseconds; they take it as gone after three intervals
     * without news of it.
     * @default 2000
     */
    heartbeatInterval?: number
    /**
     * How long `request()` and `requestAll()` wait for the answers by default, in milliseconds.
     * @default 5000
     */
    requestTimeout?: number
}

/**
 * A node of a {@link Cluster}: an instance of the application.
 */
export interface ClusterNode {
    /**
     * Its id.
     */
    readonly id: string
    /**
     * Its labels.
     */
    readonly labels: Readonly<Record<string, string>>
    /**
     * What it offers, by service (`Cluster.announce()`): the address and the load of its TURN server under `turn`.
     */
    readonly services: Readonly<Record<string, unknown>>
    /**
     * Whether it is this node.
     */
    readonly local: boolean
}

/**
 * The answer of a node to `Cluster.requestAll()`.
 */
export interface ClusterReply<T = unknown> {
    /**
     * The id of the node.
     */
    readonly node: string
    /**
     * What its handler returned.
     */
    readonly result: T
}

/**
 * How a request waits.
 */
export interface ClusterRequestOptions {
    /**
     * How long to wait for the answers, in milliseconds.
     * @default the `requestTimeout` of the cluster
     */
    timeout?: number
}

/**
 * A message of the bus, as JSON
 */
type Envelope =
    | {k: 'hb', n: string, i: string, iv: number, l: Record<string, string>, s: Record<string, unknown>}
    | {k: 'bye', n: string, i: string}
    | {k: 'msg', n: string, t: string, d: unknown}
    | {k: 'req', n: string, id: string, t: string, d: unknown}
    | {k: 'res', n: string, id: string, d?: unknown, e?: string}

/**
 * Another node, as its heartbeats tell
 */
interface RemoteNode {
    readonly id: string
    readonly incarnation: string
    interval: number
    labels: Record<string, string>
    services: Record<string, unknown>
    lastSeen: number
}

/**
 * A request waiting for its answers
 */
interface PendingRequest {
    readonly topic: string
    readonly timer: NodeJS.Timeout
    //request(): the node asked
    readonly node?: string
    //requestAll(): the nodes not answered yet, and the answers so far
    readonly awaited?: Set<string>
    readonly replies?: ClusterReply[]
    resolve(value: unknown): void
    reject(error: Error): void
}

/**
 * The default id of a node: its host name made fit for the subjects, and a random suffix
 */
function defaultNodeId(): string {
    const host: string = hostname().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 100) || 'node'
    return `${host}-${randomBytes(4).toString('hex')}`
}

/**
 * A copy of a node for the listeners
 * @param node
 */
function nodeOf(node: RemoteNode): ClusterNode {
    return {id: node.id, labels: {...node.labels}, services: {...node.services}, local: false}
}

/**
 * The instances of an application working together: each instance is a node, and the nodes talk through a bus (NATS or
 * Redis). The other components of the package use it when they are given its name (their `cluster` option): the
 * signaling puts the members of all the nodes in the same rooms, the TURN servers tell the others their address and
 * their load, the media servers of the nodes share the rooms, and a DELETE or a PATCH of a session of WHIP or WHEP is
 * applied on the node holding the session. The application may use it too: messages to all the nodes (`publish`,
 * `subscribe`), requests to one node or to all (`request`, `requestAll`, `handle`).
 *
 * Each node tells the others it is there every `heartbeatInterval`, with its labels and what it offers
 * (`announce()`); the others take it as gone after three intervals without news of it, or at once when it stops. The
 * component emits `node-up`, `node-down` and `node-update` with the {@link ClusterNode}. The bus carries only these
 * messages: the media go directly between the clients and the nodes.
 *
 * Register it with {@link buildClusterOptions}; its `transport` is required.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 * import {buildClusterOptions, buildSignalingOptions, SignalingController} from '@lakutata/webrtc'
 *
 * //Each pod of the deployment is a node; the members connected to any of them meet in the same rooms
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         cluster: buildClusterOptions({transport: {type: 'nats', servers: process.env.NATS_URL}}),
 *         signaling: buildSignalingOptions({cluster: 'cluster'}),
 *         entrypoint: buildEntrypoints({
 *             controllers: [SignalingController],
 *             service: socketIOServiceEntrypoint({port: 3000})
 *         })
 *     },
 *     bootstrap: ['signaling', 'entrypoint']
 * }))
 * ```
 */
@Singleton()
export class Cluster extends Component {

    /**
     * The bus.
     */
    @Configurable(DTO.Alternatives(
        DTO.Object({type: DTO.String().valid('memory').required()}),
        DTO.Object({
            type: DTO.String().valid('nats').required(),
            servers: DTO.Alternatives(DTO.String(), DTO.Array().items(DTO.String())).optional(),
            user: DTO.String().optional(),
            pass: DTO.String().optional(),
            token: DTO.String().optional(),
            name: DTO.String().optional()
        }),
        DTO.Object({
            type: DTO.String().valid('redis').required(),
            url: DTO.String().optional(),
            host: DTO.String().optional(),
            port: DTO.Number().port().optional(),
            database: DTO.Number().integer().min(0).optional(),
            username: DTO.String().optional(),
            password: DTO.String().optional(),
            tls: DTO.Boolean().optional()
        })
    ).required())
    protected readonly transport: ClusterTransportOptions

    /**
     * The prefix of the subjects.
     */
    @Configurable(DTO.String().pattern(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/).optional().default('lakutata.webrtc'))
    protected readonly prefix: string

    /**
     * The id of this node, unique in the cluster.
     */
    @Configurable(DTO.String().pattern(/^[A-Za-z0-9_-]{1,128}$/).optional().default((): string => defaultNodeId()))
    public readonly nodeId: string

    /**
     * The labels of this node.
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional().default({}))
    protected readonly labels: Record<string, string>

    /**
     * The heartbeat interval, in milliseconds.
     */
    @Configurable(DTO.Number().integer().min(100).optional().default(2000))
    protected readonly heartbeatInterval: number

    /**
     * How long the requests wait by default, in milliseconds.
     */
    @Configurable(DTO.Number().integer().positive().optional().default(5000))
    protected readonly requestTimeout: number

    readonly #incarnation: string = randomUUID()

    readonly #nodes: Map<string, RemoteNode> = new Map()

    readonly #services: Record<string, unknown> = {}

    readonly #listeners: Map<string, Set<(message: unknown, from: string) => void>> = new Map()

    readonly #handlers: Map<string, (message: unknown, from: string) => unknown> = new Map()

    readonly #pending: Map<string, PendingRequest> = new Map()

    readonly #assembler: FrameAssembler = new FrameAssembler()

    #bus: ClusterTransport

    #heartbeat: NodeJS.Timeout

    #stopped: boolean = false

    /**
     * Connect to the bus, and tell the other nodes this one is there.
     * @protected
     */
    protected async init(): Promise<void> {
        const transport: ClusterTransportOptions = this.transport
        this.#bus = transport.type === 'nats' ? new NATSClusterTransport(transport) : transport.type === 'redis' ? new RedisClusterTransport(transport) : new MemoryClusterTransport()
        await this.#bus.connect()
        const received = (data: Uint8Array): void => {
            const message: Buffer | undefined = this.#assembler.add(data)
            if (!message) return
            let envelope: Envelope
            try {
                envelope = JSON.parse(message.toString())
            } catch {
                return
            }
            this.receive(envelope)
        }
        await this.#bus.subscribe(this.subjectOf(), received)
        await this.#bus.subscribe(this.subjectOf(this.nodeId), received)
        //Back on the bus: the others may have taken this node as gone, and it may have missed their news
        this.#bus.onReconnect((): void => this.beat())
        this.beat()
        this.#heartbeat = setInterval((): void => {
            this.beat()
            this.expire()
        }, this.heartbeatInterval)
        this.#heartbeat.unref()
    }

    /**
     * Tell the other nodes this one stops, and close the connection to the bus.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#stopped = true
        clearInterval(this.#heartbeat)
        for (const [id, pending] of [...this.#pending]) this.settle(id, pending, (): void => pending.reject(new ClusterRequestException('The cluster stopped')))
        if (!this.#bus) return
        this.send(undefined, {k: 'bye', n: this.nodeId, i: this.#incarnation})
        await this.#bus.close()
    }

    /**
     * The nodes of the cluster: this one first, then the others seen in the last three heartbeat intervals.
     * @returns The nodes.
     * @example
     * ```typescript
     * import type {Cluster, ClusterNode} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * //['meet-7c9f-a1b2c3d4', 'meet-7c9f-e5f60718']
     * console.log(cluster.nodes().map((node: ClusterNode): string => node.id))
     * ```
     */
    public nodes(): ClusterNode[] {
        return [
            {id: this.nodeId, labels: {...this.labels}, services: {...this.#services}, local: true},
            ...[...this.#nodes.values()].map(nodeOf)
        ]
    }

    /**
     * Tell the other nodes what this node offers for a service (they see it in the `services` of its node); `undefined`
     * withdraws it. A new or withdrawn service is sent at once, a changed one with the next heartbeat.
     * @param service The service.
     * @param info What the nodes get about it, as JSON.
     * @example
     * ```typescript
     * import type {Cluster} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * cluster.announce('recorder', {disk: 0.42})
     * ```
     */
    public announce(service: string, info: unknown): void {
        const known: boolean = service in this.#services
        if (info === undefined) {
            delete this.#services[service]
        } else {
            this.#services[service] = info
        }
        if (known !== (info !== undefined) && this.#bus && !this.#stopped) this.beat()
    }

    /**
     * Send a message to the other nodes: their listeners of the topic receive it (this node's do not).
     * @param topic The topic.
     * @param message The message, as JSON.
     * @example
     * ```typescript
     * import type {Cluster} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * cluster.publish('announcements', {text: 'The meeting starts in 5 minutes'})
     * ```
     */
    public publish(topic: string, message: unknown): void {
        this.send(undefined, {k: 'msg', n: this.nodeId, t: topic, d: message})
    }

    /**
     * Receive the messages of a topic from the other nodes.
     * @param topic The topic.
     * @param listener Called with the message and the id of the node sending it.
     * @returns A function ending the subscription.
     * @example
     * ```typescript
     * import type {Cluster} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * const unsubscribe: () => void = cluster.subscribe<{text: string}>('announcements', (message: {text: string}, from: string): void => console.log(from, message.text))
     * ```
     */
    public subscribe<T = unknown>(topic: string, listener: (message: T, from: string) => void): () => void {
        if (!this.#listeners.has(topic)) this.#listeners.set(topic, new Set())
        const listeners: Set<(message: unknown, from: string) => void> = this.#listeners.get(topic)!
        const added = (message: unknown, from: string): void => listener(message as T, from)
        listeners.add(added)
        return (): void => {
            listeners.delete(added)
            if (!listeners.size) this.#listeners.delete(topic)
        }
    }

    /**
     * Answer the requests of a topic (from `request()` and `requestAll()`), replacing the handler it had.
     * @param topic The topic.
     * @param handler Called with the message and the id of the node asking; what it returns (or resolves to) is the
     * answer, as JSON, and what it throws fails the request.
     * @returns A function removing the handler.
     * @example
     * ```typescript
     * import type {Cluster} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * cluster.handle<{room: string}, number>('viewers', ({room}: {room: string}): number => room.length)
     * ```
     */
    public handle<T = unknown, R = unknown>(topic: string, handler: (message: T, from: string) => R | Promise<R>): () => void {
        const added = (message: unknown, from: string): unknown => handler(message as T, from)
        this.#handlers.set(topic, added)
        return (): void => {
            if (this.#handlers.get(topic) === added) this.#handlers.delete(topic)
        }
    }

    /**
     * Ask a node, and wait for its answer. A request to this node calls its handler directly.
     * @param node The id of the node.
     * @param topic The topic of its handler.
     * @param message The message, as JSON.
     * @param options How long to wait.
     * @returns The answer of its handler.
     * @throws {ClusterRequestException} When the node is not in the cluster, has no handler of the topic, or its
     * handler failed.
     * @throws {ClusterTimeoutException} When it does not answer in time.
     * @example
     * ```typescript
     * import type {Cluster} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * const viewers: number = await cluster.request<number>('meet-7c9f-e5f60718', 'viewers', {room: 'meeting'}, {timeout: 1000})
     * ```
     */
    public async request<R = unknown>(node: string, topic: string, message: unknown, options: ClusterRequestOptions = {}): Promise<R> {
        if (node === this.nodeId) {
            const handler: ((message: unknown, from: string) => unknown) | undefined = this.#handlers.get(topic)
            if (!handler) throw new ClusterRequestException('The node {node} has no handler of {topic}', {node: node, topic: topic})
            return await handler(JSON.parse(JSON.stringify(message ?? null)), this.nodeId) as R
        }
        if (!this.#nodes.has(node)) throw new ClusterRequestException('The node {node} is not in the cluster', {node: node})
        const id: string = randomUUID()
        const timeout: number = options.timeout ?? this.requestTimeout
        return await new Promise<R>((resolve: (value: R) => void, reject: (error: Error) => void): void => {
            const timer: NodeJS.Timeout = setTimeout((): void => {
                this.settle(id, this.#pending.get(id), (): void => reject(new ClusterTimeoutException('The node {node} did not answer {topic} in {timeout} ms', {node: node, topic: topic, timeout: timeout})))
            }, timeout)
            this.#pending.set(id, {topic: topic, timer: timer, node: node, resolve: resolve as (value: unknown) => void, reject: reject})
            this.send(node, {k: 'req', n: this.nodeId, id: id, t: topic, d: message})
        })
    }

    /**
     * Ask all the other nodes, and wait until each answered or the time is up.
     * @param topic The topic of their handlers.
     * @param message The message, as JSON.
     * @param options How long to wait at most.
     * @returns The answers of the nodes whose handler answered (not those without a handler of the topic, those whose
     * handler failed, or those answering late).
     * @example
     * ```typescript
     * import type {Cluster, ClusterReply} from '@lakutata/webrtc'
     *
     * declare const cluster: Cluster
     * const replies: ClusterReply<number>[] = await cluster.requestAll<number>('viewers', {room: 'meeting'})
     * const viewers: number = replies.reduce((sum: number, reply: ClusterReply<number>): number => sum + reply.result, 0)
     * ```
     */
    public async requestAll<R = unknown>(topic: string, message: unknown, options: ClusterRequestOptions = {}): Promise<ClusterReply<R>[]> {
        const awaited: Set<string> = new Set(this.#nodes.keys())
        if (!awaited.size) return []
        const id: string = randomUUID()
        const replies: ClusterReply[] = []
        return await new Promise<ClusterReply<R>[]>((resolve: (value: ClusterReply<R>[]) => void, reject: (error: Error) => void): void => {
            const timer: NodeJS.Timeout = setTimeout((): void => {
                this.settle(id, this.#pending.get(id), (): void => resolve(replies as ClusterReply<R>[]))
            }, options.timeout ?? this.requestTimeout)
            this.#pending.set(id, {topic: topic, timer: timer, awaited: awaited, replies: replies, resolve: resolve as (value: unknown) => void, reject: reject})
            this.send(undefined, {k: 'req', n: this.nodeId, id: id, t: topic, d: message})
        })
    }

    /**
     * The subject of a node, or of all the nodes
     * @param node The id of the node; none for all the nodes.
     * @protected
     */
    protected subjectOf(node?: string): string {
        return node === undefined ? `${this.prefix}.all` : `${this.prefix}.node.${node}`
    }

    /**
     * Send an envelope to a node, or to all of them
     * @param node The id of the node; none for all the nodes.
     * @param envelope The message.
     * @protected
     */
    protected send(node: string | undefined, envelope: Envelope): void {
        if (!this.#bus) return
        const subject: string = this.subjectOf(node)
        for (const frame of framesOf(Buffer.from(JSON.stringify(envelope)), this.#bus.maxPayload)) this.#bus.publish(subject, frame)
    }

    /**
     * Send a heartbeat to all the nodes
     * @param node Only to this node (an answer to its first heartbeat).
     * @protected
     */
    protected beat(node?: string): void {
        if (this.#stopped) return
        this.send(node, {k: 'hb', n: this.nodeId, i: this.#incarnation, iv: this.heartbeatInterval, l: this.labels, s: this.#services})
    }

    /**
     * Take as gone the nodes without news for three of their heartbeat intervals
     * @protected
     */
    protected expire(): void {
        const now: number = Date.now()
        for (const node of [...this.#nodes.values()]) {
            if (now - node.lastSeen > node.interval * 3) this.gone(node)
        }
    }

    /**
     * Forget a node: its requests fail, `requestAll()` stops waiting for it, `node-down` is emitted
     * @param node The node.
     * @protected
     */
    protected gone(node: RemoteNode): void {
        if (this.#nodes.get(node.id) !== node) return
        this.#nodes.delete(node.id)
        for (const [id, pending] of [...this.#pending]) {
            if (pending.node === node.id) {
                this.settle(id, pending, (): void => pending.reject(new ClusterRequestException('The node {node} left the cluster', {node: node.id})))
            } else if (pending.awaited?.delete(node.id) && !pending.awaited.size) {
                this.settle(id, pending, (): void => pending.resolve(pending.replies))
            }
        }
        this.emit('node-down', nodeOf(node))
    }

    /**
     * Remove a pending request and settle it
     * @param id The id of the request.
     * @param pending The request.
     * @param settle Resolves or rejects it.
     * @protected
     */
    protected settle(id: string, pending: PendingRequest | undefined, settle: () => void): void {
        if (!pending || this.#pending.get(id) !== pending) return
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        settle()
    }

    /**
     * Handle an envelope from the bus
     * @param envelope The message.
     * @protected
     */
    protected receive(envelope: Envelope): void {
        if (this.#stopped || !envelope || typeof envelope.n !== 'string' || envelope.n === this.nodeId) return
        const sender: RemoteNode | undefined = this.#nodes.get(envelope.n)
        if (sender) sender.lastSeen = Date.now()
        switch (envelope.k) {
            case 'hb':
                return this.heard(envelope)
            case 'bye':
                if (sender?.incarnation === envelope.i) this.gone(sender)
                return
            case 'msg':
                this.#listeners.get(envelope.t)?.forEach((listener: (message: unknown, from: string) => void): void => {
                    try {
                        listener(envelope.d, envelope.n)
                    } catch {
                        //A listener failing does not stop the others
                    }
                })
                return
            case 'req':
                return void this.answer(envelope)
            case 'res':
                return this.answered(envelope)
        }
    }

    /**
     * Handle a heartbeat: a new node (or a node restarted) is up, a known one updated
     * @param heartbeat The heartbeat.
     * @protected
     */
    protected heard(heartbeat: Extract<Envelope, {k: 'hb'}>): void {
        const known: RemoteNode | undefined = this.#nodes.get(heartbeat.n)
        if (known && known.incarnation === heartbeat.i) {
            const changed: boolean = JSON.stringify([known.labels, known.services]) !== JSON.stringify([heartbeat.l, heartbeat.s])
            known.interval = heartbeat.iv
            known.labels = heartbeat.l ?? {}
            known.services = heartbeat.s ?? {}
            if (changed) this.emit('node-update', nodeOf(known))
            return
        }
        //Restarted with the same id: the node it was is gone
        if (known) this.gone(known)
        const node: RemoteNode = {id: heartbeat.n, incarnation: heartbeat.i, interval: heartbeat.iv, labels: heartbeat.l ?? {}, services: heartbeat.s ?? {}, lastSeen: Date.now()}
        this.#nodes.set(node.id, node)
        //It learns about this node at once rather than at the next heartbeat
        this.beat(node.id)
        this.emit('node-up', nodeOf(node))
    }

    /**
     * Answer a request with its handler
     * @param request The request.
     * @protected
     */
    protected async answer(request: Extract<Envelope, {k: 'req'}>): Promise<void> {
        const handler: ((message: unknown, from: string) => unknown) | undefined = this.#handlers.get(request.t)
        if (!handler) return this.send(request.n, {k: 'res', n: this.nodeId, id: request.id, e: `The node ${this.nodeId} has no handler of ${request.t}`})
        try {
            const result: unknown = await handler(request.d, request.n)
            this.send(request.n, {k: 'res', n: this.nodeId, id: request.id, d: result === undefined ? null : result})
        } catch (error) {
            this.send(request.n, {k: 'res', n: this.nodeId, id: request.id, e: (error as Error)?.message ?? String(error)})
        }
    }

    /**
     * Handle an answer to a request of this node
     * @param response The answer.
     * @protected
     */
    protected answered(response: Extract<Envelope, {k: 'res'}>): void {
        const pending: PendingRequest | undefined = this.#pending.get(response.id)
        if (!pending) return
        if (pending.awaited) {
            pending.awaited.delete(response.n)
            if (response.e === undefined) pending.replies!.push({node: response.n, result: response.d})
            if (!pending.awaited.size) this.settle(response.id, pending, (): void => pending.resolve(pending.replies))
            return
        }
        if (pending.node !== response.n) return
        this.settle(response.id, pending, (): void => response.e === undefined
            ? pending.resolve(response.d)
            : pending.reject(new ClusterRequestException('The node {node} failed to answer {topic}: {reason}', {node: response.n, topic: pending.topic, reason: response.e})))
    }
}

/**
 * Build the options of a {@link Cluster} component, for the `components` of an application.
 * @param options The bus (required), the prefix of its subjects, the id and the labels of this node, the intervals.
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildClusterOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         cluster: buildClusterOptions({
 *             transport: {type: 'redis', url: process.env.REDIS_URL},
 *             nodeId: process.env.POD_NAME,
 *             labels: {zone: process.env.ZONE ?? 'default'}
 *         })
 *     }
 * }))
 * ```
 */
export function buildClusterOptions(options: ClusterOptions): ComponentOptions<ClusterOptions> {
    return {class: Cluster, ...options}
}
