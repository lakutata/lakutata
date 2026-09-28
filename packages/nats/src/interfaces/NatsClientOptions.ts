import {Codec} from 'nats'

export interface NatsClientOptions {
    servers: string | string[]
    codec?: Codec<unknown>
    timeout?: number
    token?: string
    user?: string
    pass?: string
    debug?: boolean
    maxPingOut?: number
    maxReconnectAttempts?: number
    name?: string
    noEcho?: boolean
    noRandomize?: boolean
    pingInterval?: number
    reconnect?: boolean
    /** Enable the bulk channel of the large payloads (a second connection and an object store), true by default */
    bulk?: boolean
    /** The bucket of the bulk object store, lkt-bulk-${name} by default */
    bulkBucket?: string
    /** ms, the time to live of the bulk objects, 5 minutes by default */
    bulkTTL?: number
    /** The replicas of the bulk bucket, the default of the server when omitted (the objects are deleted once read) */
    bulkReplicas?: number
}