import type {EntrypointAdapter, MiddlewareDefinition, ServiceContext} from '@lakutata/entrypoint'
import {JSONRPCProtocol, ServiceChannel, type ChannelRuntime} from '@lakutata/entrypoint/channel'
import {JSONRPCErrorCode, type JSONRPCMappingOptions} from '@lakutata/entrypoint/adapter/jsonrpc'
import {ChunkedChannel} from '../shared/ChunkedChannel.js'
import {SignalingRequestError} from '../shared/SignalingError.js'
import {SignalingClient, type Peer, type Room, type SignalingClientOptions} from '../peer/SignalingClient.js'
import type {PeerChannel} from '../peer/PeerChannel.js'

/**
 * The options of {@link webrtcServiceEntrypoint}: the signaling client whose rooms it serves, the rooms, the label of
 * the channels, and how the requests map to the service actions (`methodField`, `toPattern`, `positionalParams`, as
 * with `jsonRPCServiceEntrypoint`).
 */
export type WebRTCServiceEntrypointOptions = JSONRPCMappingOptions & {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The options of a signaling client created by the adapter (its `url`, its `id`: the member id of the application
     * in the rooms). The adapter closes it when it stops. Give either `signaling` or `client`.
     */
    signaling?: SignalingClientOptions
    /**
     * A function returning the signaling client of the application, when the application also uses it (to publish its
     * camera to the same rooms, for example): two clients with the same id would replace each other in the rooms. It is
     * called once the application has launched; the adapter neither leaves its rooms nor closes it. Give either
     * `signaling` or `client`.
     */
    client?: (runtime: ChannelRuntime<ServiceContext>) => SignalingClient | Promise<SignalingClient>
    /**
     * The rooms whose members may call the service actions. They are joined once the application has launched (a room
     * the client has joined already is served as it is); a failed join is reported to `onError` and tried again after 1
     * second, then after twice as long each time, up to 10 seconds, except when the signaling refuses the room
     * (`E_SIGNALING_DENIED`).
     */
    rooms: string[]
    /**
     * The metadata of the application in the rooms it joins, given to the other members.
     * @default none
     */
    metadata?: unknown
    /**
     * The label of the data channels carrying the requests: the members create a channel with this label to the
     * application; the channels with other labels are left to the application.
     * @default 'service'
     */
    label?: string
    /**
     * The largest request, in bytes: a larger one is dropped and answered with an Invalid Request error without id
     * (`-32600`).
     * @default 10485760 (10 MiB)
     */
    limit?: number
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Called when a room cannot be joined, or the signaling client cannot be got, with the error.
     * @default the error is written to the application's `log` component (`console.error` without one)
     */
    onError?: (error: unknown) => void | Promise<void>
}

/**
 * The member behind a service action's request served by {@link webrtcServiceEntrypoint}, as
 * {@link webrtcRequestOfContext} returns it.
 */
export type WebRTCRequestInfo = {
    /**
     * The member that called: its id (also the context's `clientId`), its metadata and its session.
     */
    peer: Peer
    /**
     * The room the member called through.
     */
    room: Room
    /**
     * The data channel the request came through.
     */
    channel: PeerChannel
}

/**
 * The first delay before a failed join is tried again, in milliseconds
 */
const FIRST_RETRY_DELAY: number = 1000

/**
 * The longest delay before a failed join is tried again, in milliseconds
 */
const MAX_RETRY_DELAY: number = 10000

/**
 * How long closing waits for the responses being sent, in milliseconds
 */
const CLOSE_SEND_TIMEOUT: number = 2000

/**
 * Get the member that called a service action through a data channel, when {@link webrtcServiceEntrypoint} serves the
 * request (to read its metadata, the room it called through, or close its channel).
 * @param context The service action's context (`this.context` in a controller).
 * @returns The member, its room and its channel, or `undefined` when another adapter serves the request.
 * @example
 * ```typescript
 * import {Controller, type ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {webrtcRequestOfContext, type WebRTCRequestInfo} from '@lakutata/webrtc'
 *
 * class WhoController extends Controller {
 *     @ServiceAction({method: 'whoami'})
 *     public async whoami(): Promise<{id?: string, room?: string}> {
 *         const request: WebRTCRequestInfo | undefined = webrtcRequestOfContext(this.context as ServiceContext)
 *         return {id: request?.peer.id, room: request?.room.name}
 *     }
 * }
 * ```
 */
export function webrtcRequestOfContext(context: ServiceContext): WebRTCRequestInfo | undefined {
    return (context as ServiceContext & {webrtc?: WebRTCRequestInfo}).webrtc
}

/**
 * Create a service adapter of an entrypoint served through WebRTC data channels: the application joins rooms of a
 * signaling server as a member, and the other members (browsers, applications) call its service actions directly, over
 * their peer-to-peer connection to it. A member creates a data channel with the adapter's label (`'service'` by
 * default) to the application; with `PeerServiceProxy` (`@lakutata/webrtc/client` in the browsers), it calls the
 * actions through it and receives the events pushed to it. In a room with a media server, the channel goes through
 * the server, which sees the messages.
 *
 * The messages are JSON-RPC 2.0, as with `jsonRPCServiceEntrypoint`: the requests, the batches, the notifications, the
 * error codes, and the events pushed as notifications. Each message is cut into chunks as `ChunkedChannel` does: each
 * frame is a binary message whose first byte holds the flags (1: the last chunk of a message, 2: a text message) and
 * the rest a part of the message, so a message of any size goes through.
 *
 * The client id of a request (`ServiceContext.clientId`) is the member id of the caller, and
 * {@link webrtcRequestOfContext} gives its peer, room and channel. The member id is as trustworthy as the signaling
 * server makes it: the server sends the signals of a member with the id it knows it by, so a member cannot pass for
 * another one, but the id of a member is the client id of its connection to the signaling, which the client gives. Have
 * the signaling server check who its clients are (its `authorize` option, the entrypoint's access control) before
 * relying on the ids in the access control of the actions; the metadata of a member is what the member gave.
 *
 * `Entrypoint.notify(<member id>, …)` pushes an event to every channel of the member, `Entrypoint.broadcast()` to
 * every channel. When a channel closes (its member left), its requests in progress are aborted. When the entrypoint
 * stops, the new requests are answered with a `STOPPING` error (`-32001`); once the requests in progress are answered,
 * the channels are closed, and the signaling client created by the adapter leaves its rooms.
 * @param options The signaling client, the rooms, the label of the channels, the mapping of the requests.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {webrtcServiceEntrypoint} from '@lakutata/webrtc'
 *
 * class DoorController extends Controller {
 *     @ServiceAction({method: 'door.status'})
 *     public async status(input: {door: string}): Promise<{door: string, open: boolean}> {
 *         return {door: input.door, open: false}
 *     }
 * }
 *
 * //A device in a private network: the browsers joining its room call its actions without going through a server
 * Application.run({
 *     id: 'door.device',
 *     name: 'Door',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [DoorController],
 *             service: webrtcServiceEntrypoint({
 *                 signaling: {url: 'https://signaling.example.com', id: 'door-7'},
 *                 rooms: ['door-7']
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 * ```
 */
export function webrtcServiceEntrypoint(options: WebRTCServiceEntrypointOptions): EntrypointAdapter<ServiceContext> {
    const label: string = options.label ?? 'service'
    const limit: number = options.limit ?? 10 * 1024 * 1024
    const protocol: JSONRPCProtocol = new JSONRPCProtocol(options)
    let client: SignalingClient | undefined
    let owned: boolean = false
    let stopping: boolean = false
    let closed: boolean = false
    //The channels of each member
    const clients: Map<string, Set<ChunkedChannel>> = new Map()
    //The end of the serving of each channel, of each peer, of each room
    const channels: Map<ChunkedChannel, () => void> = new Map()
    const peers: Map<Peer, () => void> = new Map()
    const rooms: Map<Room, () => void> = new Map()
    //The responses and the events being sent, awaited before the channels close
    const sending: Set<Promise<void>> = new Set()
    const timers: Set<ReturnType<typeof setTimeout>> = new Set()

    /**
     * Give an error to the onError handler, or write it to the log of the application
     * @param runtime
     * @param error
     * @param message
     */
    const report = async (runtime: ChannelRuntime<ServiceContext>, error: unknown, message: string): Promise<void> => {
        if (options.onError) {
            try {
                return await options.onError(error)
            } catch (handlerError: unknown) {
                error = handlerError
                message = 'The onError handler of the WebRTC service adapter failed'
            }
        }
        try {
            const logger: any = await runtime.getObject('log')
            logger.error(error, message)
        } catch {
            console.error(`${message}:`, error)
        }
    }

    /**
     * Send a message on a channel, if it is open
     * @param chunked
     * @param message
     */
    const send = (chunked: ChunkedChannel, message: string): boolean => {
        if (closed) return false
        const sent: Promise<void> = chunked.send(message).catch((): void => undefined)
        sending.add(sent)
        void sent.finally((): boolean => sending.delete(sent))
        return true
    }

    /**
     * Serve the requests of a channel of a member
     * @param runtime
     * @param channel
     * @param peer
     * @param room
     */
    const serveChannel = (runtime: ChannelRuntime<ServiceContext>, channel: PeerChannel, peer: Peer, room: Room): void => {
        if (stopping || closed) return channel.close()
        let chunked: ChunkedChannel
        try {
            chunked = new ChunkedChannel(channel, {maxMessageSize: limit})
        } catch {
            //An unordered channel
            return channel.close()
        }
        const abort: AbortController = new AbortController()
        const info: WebRTCRequestInfo = {peer: peer, room: room, channel: channel}
        const answer = async (data: string | Uint8Array): Promise<void> => {
            if (typeof data !== 'string') {
                send(chunked, JSON.stringify({jsonrpc: '2.0', id: null, error: {code: JSONRPCErrorCode.INVALID_REQUEST, message: 'The message is not text'}}))
                return
            }
            const response: unknown = await protocol.handle(data, {
                runtime: runtime,
                transport: 'webrtc',
                clientId: peer.id,
                extra: {webrtc: info},
                signal: abort.signal,
                stopping: (): boolean => stopping
            })
            if (response !== undefined && !abort.signal.aborted) send(chunked, JSON.stringify(response))
        }
        chunked.on('message', (data: string | Uint8Array): void => void answer(data))
        chunked.on('error', (error: Error): void => void send(chunked, JSON.stringify({jsonrpc: '2.0', id: null, error: {code: JSONRPCErrorCode.INVALID_REQUEST, message: error.message}})))
        const members: Set<ChunkedChannel> = clients.get(peer.id) ?? new Set()
        clients.set(peer.id, members)
        members.add(chunked)
        const end = (): void => {
            if (!channels.delete(chunked)) return
            channel.removeEventListener('close', end)
            peer.off('close', end)
            abort.abort()
            members.delete(chunked)
            if (!members.size && clients.get(peer.id) === members) clients.delete(peer.id)
        }
        channels.set(chunked, end)
        channel.addEventListener('close', end)
        peer.on('close', end)
        if (channel.readyState === 'closed') end()
    }

    /**
     * Serve the channels a member creates
     * @param runtime
     * @param peer
     * @param room
     */
    const servePeer = (runtime: ChannelRuntime<ServiceContext>, peer: Peer, room: Room): void => {
        if (peers.has(peer) || peer.closed) return
        const onChannel = (channel: PeerChannel): void => {
            if (channel.label === label) serveChannel(runtime, channel, peer, room)
        }
        const end = (): void => {
            peers.delete(peer)
            peer.off('datachannel', onChannel)
            peer.off('close', end)
        }
        peers.set(peer, end)
        peer.on('datachannel', onChannel)
        peer.on('close', end)
    }

    /**
     * Serve the members of a room
     * @param runtime
     * @param room
     */
    const serveRoom = (runtime: ChannelRuntime<ServiceContext>, room: Room): void => {
        if (rooms.has(room)) return
        const onPeer = (peer: Peer): void => servePeer(runtime, peer, room)
        const end = (): void => {
            rooms.delete(room)
            room.off('peer', onPeer)
            room.off('close', end)
        }
        rooms.set(room, end)
        //Called at once for the peers already there
        room.on('peer', onPeer)
        room.on('close', end)
    }

    /**
     * Join a room and serve it; tried again later when it fails, unless the signaling refuses the room
     * @param runtime
     * @param name
     * @param delay
     */
    const join = async (runtime: ChannelRuntime<ServiceContext>, name: string, delay: number): Promise<void> => {
        if (closed || !client) return
        try {
            const room: Room = client.rooms.find((each: Room): boolean => each.name === name && !each.left) ?? await client.join(name, {metadata: options.metadata})
            if (!closed) serveRoom(runtime, room)
        } catch (error: unknown) {
            if (closed) return
            await report(runtime, error, `The WebRTC service adapter could not join the room ${name}`)
            if (closed || (error instanceof SignalingRequestError && error.errno === 'E_SIGNALING_DENIED')) return
            const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
                timers.delete(timer)
                void join(runtime, name, Math.min(delay * 2, MAX_RETRY_DELAY))
            }, delay)
            timers.add(timer)
        }
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            if (!options.signaling === !options.client) throw new TypeError('Give the WebRTC service adapter either the options of a signaling client (signaling) or a function returning one (client)')
            if (!options.rooms?.length) throw new TypeError('Give the WebRTC service adapter the rooms to serve (rooms)')
            //Created now, so its invalid options fail the start; it connects by itself, the rooms wait for the launch
            if (options.signaling) {
                client = await runtime.getObject(SignalingClient, options.signaling)
                owned = true
            }
            //Once the application has launched: a signaling server of the same application is listening then
            void runtime.ready.then(async (): Promise<void> => {
                if (closed) return
                if (!client) {
                    try {
                        client = await options.client!(runtime)
                    } catch (error: unknown) {
                        return await report(runtime, error, 'The WebRTC service adapter could not get its signaling client')
                    }
                }
                for (const name of options.rooms) void join(runtime, name, FIRST_RETRY_DELAY)
            })
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const members: Set<ChunkedChannel> | undefined = clients.get(clientId)
            if (!members?.size) return false
            const notification: string = JSONRPCProtocol.notification(event, args)
            members.forEach((chunked: ChunkedChannel): unknown => send(chunked, notification))
            return true
        },
        broadcast: (event: string, args: unknown[]): number => {
            const notification: string = JSONRPCProtocol.notification(event, args)
            channels.forEach((_end: () => void, chunked: ChunkedChannel): unknown => send(chunked, notification))
            return clients.size
        },
        close: async (): Promise<void> => {
            //The responses of the requests ended are sent before the channels close
            if (sending.size) {
                let timer: ReturnType<typeof setTimeout> | undefined
                await Promise.race([
                    Promise.allSettled([...sending]),
                    new Promise<void>((resolve: () => void): void => {
                        timer = setTimeout(resolve, CLOSE_SEND_TIMEOUT)
                    })
                ])
                clearTimeout(timer)
            }
            closed = true
            timers.forEach((timer: ReturnType<typeof setTimeout>): void => clearTimeout(timer))
            timers.clear()
            for (const [chunked, end] of [...channels]) {
                end()
                chunked.close()
            }
            for (const end of [...peers.values(), ...rooms.values()]) end()
            clients.clear()
            if (owned) await client?.close()
            client = undefined
        }
    }
}
