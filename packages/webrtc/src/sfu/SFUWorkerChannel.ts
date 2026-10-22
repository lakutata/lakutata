import type {Transferable} from 'node:worker_threads'
import type {SignalingDescription, SignalingPeer, SignalingRole, SignalingStream, SignalingCandidate} from '../protocol/SignalingProtocol.js'
import type {SFUTrack} from './SFU.js'
import type {SFUOfferedTrack} from './SFURoom.js'

/**
 * The codec of a track published, as the worker thread gives it (the fields of the codec parameters of the engine)
 */
export interface SFUWorkerCodec {
    readonly payloadType?: number
    readonly mimeType: string
    readonly clockRate: number
    readonly channels?: number
    readonly parameters?: string
}

/**
 * The track of the engine of a track published: its id and its codec
 */
export interface SFUWorkerMedia {
    readonly id: string
    readonly codec?: SFUWorkerCodec
}

/**
 * The messages of the main thread to a worker thread forwarding rooms. `ref` is the number of a room in the pool (the
 * same name may be served again by another), `leg` the id of a member published with WHIP or of a viewer of WHEP.
 */
export type SFUToWorker =
    | {type: 'open', request: number, ref: number, room: string, id: string}
    | {type: 'close', request: number, ref: number}
    | {type: 'publish', request: number, ref: number, peerId: string, offer: SignalingDescription}
    | {type: 'play', request: number, ref: number, viewerId: string, offer: SignalingDescription, select: boolean}
    | {type: 'patch', request: number, leg: string, fragment: string, restart: boolean}
    | {type: 'end', leg: string}
    | {type: 'receive', ref: number, peerId: string, event: string, payload: unknown}
    | {type: 'stream', ref: number, peerId: string, trackId: string, wanted: boolean}
    | {type: 'keyframe', ref: number, peerId: string, trackId: string}
    | {type: 'stop', request: number}
    | {type: 'debug', enabled: boolean}

/**
 * The messages of a worker thread to the main thread
 */
export type SFUFromWorker =
    | {type: 'ready'}
    | {type: 'join', request: number, ref: number, peerId: string, role: SignalingRole}
    | {type: 'leave', request: number, ref: number, peerId: string}
    | {type: 'signal', request: number, ref: number, peerId: string, to: string, signal: {description?: SignalingDescription, candidate?: SignalingCandidate | null, streams?: SignalingStream[]}}
    | {type: 'select', request: number, subscriber: SignalingPeer, track: SFUTrack}
    | {type: 'choose', request: number, leg: string, tracks: SFUTrack[]}
    | {type: 'emit', ref: number, event: string, args: unknown[], media?: SFUWorkerMedia}
    | {type: 'state', ref: number, members: string[], viewers: number}
    | {type: 'source', leg: string, source: string | undefined}
    | {type: 'ended', leg: string}
    | {type: 'emptied', ref: number}
    | {type: 'rtp', ref: number, peerId: string, trackId: string, packet: Uint8Array, extensions?: Record<string, unknown>}
    | {type: 'log', namespace: string, message: string}
    | {type: 'known', ref: number, tracks: SFUOfferedTrack[]}

/**
 * The reply to a request
 */
interface Reply {
    type: 'reply'
    reply: number
    result?: unknown
    error?: string
}

/**
 * Where the messages go and come from: the parent port in a worker thread, the worker in the main thread
 */
export interface SFUWorkerPort {
    postMessage(message: unknown, transfer?: readonly Transferable[]): void
    on(event: 'message', listener: (message: unknown) => void): unknown
}

/**
 * The messages of a request, without their number (given by the channel)
 */
type Unnumbered<Message> = Message extends {request: number} ? Omit<Message, 'request'> : never

/**
 * The messages of a side to the other: the requests are answered (their result, or the message of their error), the
 * others are not
 */
export class SFUWorkerChannel<Incoming extends {type: string}, Outgoing extends {type: string}> {

    readonly #port: SFUWorkerPort

    readonly #pending: Map<number, {resolve(result: unknown): void, reject(error: Error): void}> = new Map()

    #next: number = 1

    #closed?: Error

    /**
     * Read the messages of a port.
     * @param port The port.
     * @param handle Handles a message; the result of a request (or its promise) is its reply.
     */
    constructor(port: SFUWorkerPort, handle: (message: Incoming) => unknown) {
        this.#port = port
        port.on('message', (message: unknown): void => {
            const received: Incoming | Reply = message as Incoming | Reply
            if (received.type === 'reply') {
                const {reply, result, error} = received as Reply
                const pending = this.#pending.get(reply)
                this.#pending.delete(reply)
                if (error === undefined) pending?.resolve(result)
                else pending?.reject(new Error(error))
                return
            }
            const request: number | undefined = (received as {request?: number}).request
            if (request === undefined) {
                //A message that is not a request has no reply
                try {
                    const result: unknown = handle(received as Incoming)
                    if (result instanceof Promise) result.catch((): void => undefined)
                } catch {
                    //Nothing to answer
                }
                return
            }
            Promise.resolve().then((): unknown => handle(received as Incoming)).then(
                (result: unknown): void => this.#reply({type: 'reply', reply: request, result: result}),
                (error: unknown): void => this.#reply({type: 'reply', reply: request, error: error instanceof Error ? error.message : String(error)})
            )
        })
    }

    /**
     * Send a request, and wait for its reply.
     * @param message The request.
     * @returns Its result.
     * @throws {Error} The error of the other side, or the one the channel closed with.
     */
    public request<Result>(message: Unnumbered<Outgoing>): Promise<Result> {
        if (this.#closed) return Promise.reject(this.#closed)
        const request: number = this.#next++
        return new Promise<Result>((resolve: (result: Result) => void, reject: (error: Error) => void): void => {
            this.#pending.set(request, {resolve: resolve as (result: unknown) => void, reject: reject})
            try {
                this.#port.postMessage({...message, request: request})
            } catch (error) {
                //A request that cannot be sent
                this.#pending.delete(request)
                reject(error as Error)
            }
        })
    }

    /**
     * Send a message that is not answered.
     * @param message The message.
     * @param transfer The buffers given to the other side.
     */
    public post(message: Outgoing, transfer?: readonly Transferable[]): void {
        if (!this.#closed) this.#port.postMessage(message, transfer)
    }

    /**
     * Close the channel: the requests waiting and the next ones fail.
     * @param error Their error.
     */
    public close(error: Error): void {
        this.#closed ??= error
        for (const {reject} of this.#pending.values()) reject(error)
        this.#pending.clear()
    }

    /**
     * Send a reply
     * @param reply
     */
    #reply(reply: Reply): void {
        if (this.#closed) return
        try {
            this.#port.postMessage(reply)
        } catch (error) {
            //A result that cannot be sent
            this.#port.postMessage({type: 'reply', reply: reply.reply, error: (error as Error).message})
        }
    }
}
