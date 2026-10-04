import {Codec} from 'nats'

/**
 * The options of the {@link NATS} component, given to {@link buildNatsClientOptions}. They are validated when the
 * component is created: an invalid value fails it.
 */
export interface NatsClientOptions {
    /**
     * The NATS server, or the servers of a cluster, to connect to: `host:port` or a URL (`nats://user:pass@host:4222`).
     * The client connects to one of them (in random order unless `noRandomize`) and moves to another on a disconnect.
     */
    servers: string | string[]
    /**
     * The codec encoding and decoding every payload: {@link MessagePackCodec}, {@link JSONCodec}, or any object with
     * `encode(value)` and `decode(bytes)`. All the applications exchanging messages on a subject must use the same one.
     * @default MessagePackCodec()
     */
    codec?: Codec<unknown>
    /**
     * The time to wait for the connection to a server to be established, in milliseconds.
     * @default 20000
     */
    timeout?: number
    /**
     * The token of the server's token authentication.
     * @default none
     */
    token?: string
    /**
     * The user name of the server's user/password authentication.
     * @default none
     */
    user?: string
    /**
     * The password of the server's user/password authentication, with `user`.
     * @default none
     */
    pass?: string
    /**
     * Whether the client prints the protocol messages it sends and receives (to debug a connection).
     * @default false
     */
    debug?: boolean
    /**
     * The number of pings left unanswered after which the connection is considered stale and the client reconnects.
     * @default 2
     */
    maxPingOut?: number
    /**
     * The number of reconnection attempts to each server before giving up, `-1` never giving up. Once given up, the
     * connection is closed for good: the calls fail with the NATS client error `CONNECTION_CLOSED` until the application
     * restarts.
     * @default 10
     */
    maxReconnectAttempts?: number
    /**
     * The client name shown by the server's monitoring. It also names the default object store bucket of the bulk
     * channel (`lkt-bulk-{name}`), and the bulk connection (`{name}-bulk`).
     * @default none
     */
    name?: string
    /**
     * Whether the messages this client publishes are never delivered to its own subscriptions.
     * @default false
     */
    noEcho?: boolean
    /**
     * Whether the servers are tried in the order given, instead of a random order.
     * @default false
     */
    noRandomize?: boolean
    /**
     * The interval between the pings the client sends to check the connection, in milliseconds.
     * @default 120000
     */
    pingInterval?: number
    /**
     * Whether the client reconnects after losing its connection (see `maxReconnectAttempts`). While it reconnects, the
     * outgoing messages are buffered and the requests wait, failing when their timeout passes.
     * @default true
     */
    reconnect?: boolean
    /**
     * Whether the bulk channel is enabled: the payloads too large for the server's `max_payload` are relayed through a
     * JetStream object store, using a second connection. It needs JetStream on the server; when the channel cannot
     * start (no JetStream, bucket rejected…), a warning is printed and the component starts without it.
     * @default true
     */
    bulk?: boolean
    /**
     * The object store bucket of the bulk channel, created when missing. The applications exchanging large payloads
     * must use the same bucket: a reference to an object of another bucket fails with {@link NatsBulkException}.
     * @default `lkt-bulk-{name}`, `lkt-bulk-default` without `name`
     */
    bulkBucket?: string
    /**
     * The time to live of the objects of the bulk channel, in milliseconds. An object is deleted once read; this removes
     * the ones never read (a requester gone, a response lost). It applies when the bucket is created.
     * @default 300000 (5 minutes)
     */
    bulkTTL?: number
    /**
     * The number of replicas of the bulk bucket in a JetStream cluster, applied when the bucket is created.
     * @default none: the server's default (one replica)
     */
    bulkReplicas?: number
}