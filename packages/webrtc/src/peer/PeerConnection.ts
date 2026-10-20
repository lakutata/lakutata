import {DTO, Provider} from '@lakutata/core'
import {Autoload, Configurable, Transient} from '@lakutata/core/decorator/di'
import type {RTCDataChannel} from '../lib/peer/dataChannel.js'
import {RTCPeerConnection, type RTCPeerConnectionConfig} from '../lib/peer/peerConnection.js'
import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {DataChannelOptions} from '../shared/Connections.js'
import {type DOMEventListener, type ListenerOptions, Events} from './Events.js'
import {PeerChannel} from './PeerChannel.js'

/**
 * The configuration of a {@link PeerConnection}: the options of `RTCConfiguration` it supports, and the ones of a
 * server.
 */
export interface PeerConnectionOptions {
    /**
     * The STUN and TURN servers; the first STUN URL and the first TURN URL are used.
     * @default []
     */
    iceServers?: SignalingIceServer[]
    /**
     * `relay` to use only the TURN relays.
     * @default 'all'
     */
    iceTransportPolicy?: 'all' | 'relay'
    /**
     * The UDP ports of the local candidates, as `[first, last]`: the range opened in the firewall or published by the
     * container.
     * @default any free port
     */
    icePortRange?: [number, number]
    /**
     * More addresses given as local candidates: the public address of a NAT forwarding `icePortRange` with the same
     * port numbers, an address normally left out (the loopback).
     * @default none
     */
    iceAdditionalHostAddresses?: string[]
    /**
     * Whether to gather IPv4 candidates.
     * @default true
     */
    iceUseIpv4?: boolean
    /**
     * Whether to gather IPv6 candidates.
     * @default true
     */
    iceUseIpv6?: boolean
}

/**
 * The events of a {@link PeerConnection}, with the arguments of their listeners in the Node.js style (`on`).
 */
export type PeerConnectionEvents = {
    /**
     * A local candidate to send to the other peer; `null` once all are gathered.
     */
    icecandidate: [candidate: SignalingCandidate | null]
    /**
     * A data channel the other peer created.
     */
    datachannel: [channel: PeerChannel]
    /**
     * A new offer is needed (a channel was added, ICE was restarted).
     */
    negotiationneeded: []
    /**
     * `connectionState` changed.
     */
    connectionstatechange: [state: string]
    /**
     * `iceConnectionState` changed.
     */
    iceconnectionstatechange: [state: string]
    /**
     * `iceGatheringState` changed.
     */
    icegatheringstatechange: [state: string]
    /**
     * `signalingState` changed.
     */
    signalingstatechange: [state: string]
}

/**
 * A local ICE candidate, as `RTCIceCandidate`
 */
class IceCandidate {
    public readonly candidate: string
    public readonly sdpMid: string | null
    public readonly sdpMLineIndex: number | null
    public readonly usernameFragment: string | null

    constructor(init: SignalingCandidate) {
        this.candidate = init.candidate
        this.sdpMid = init.sdpMid ?? null
        this.sdpMLineIndex = init.sdpMLineIndex ?? null
        this.usernameFragment = init.usernameFragment ?? null
    }

    public toJSON(): SignalingCandidate {
        return {candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex, usernameFragment: this.usernameFragment}
    }
}

/**
 * A plain description
 * @param description
 */
function plainDescription(description: {type: string, sdp: string} | undefined | null): SignalingDescription | null {
    return description ? {type: description.type as SignalingDescription['type'], sdp: description.sdp} : null
}

/**
 * A peer-to-peer connection of Node.js (and of Bun, of the main process of Electron), implemented in TypeScript: the
 * same interface as `RTCPeerConnection` of the browsers (offers and answers, candidates, data channels, ICE restart,
 * perfect negotiation), so the code and the signaling are the ones of a browser. Its events may be listened to in the
 * W3C style (`addEventListener`, the `on…` properties) or in the Node.js style (`on('datachannel', (channel) => …)`).
 *
 * Get a new one each time with `getObject(PeerConnection, options)` (it is `@Transient`, and needs no registration);
 * `close()` closes it and destroys the object, and the ones still open are closed when the application stops. With the
 * signaling of this package, `SignalingClient` creates the connections itself.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {PeerConnection, type PeerChannel, type SignalingCandidate, type SignalingDescription} from '@lakutata/webrtc'
 *
 * class Device extends Component {
 *     //Answer an offer received some other way (an HTTP request, a QR code)
 *     public async answer(offer: SignalingDescription): Promise<SignalingDescription | null> {
 *         const connection: PeerConnection = await this.getObject(PeerConnection, {iceServers: [{urls: 'stun:stun.example.com:3478'}]})
 *         connection.on('datachannel', (channel: PeerChannel): void => {
 *             channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(`echo: ${data.toString()}`))
 *         })
 *         await connection.setRemoteDescription(offer)
 *         await connection.setLocalDescription()
 *         //Wait for the candidates, to answer without trickle ICE
 *         await new Promise<void>((resolve: () => void): void => {
 *             connection.on('icecandidate', (candidate: SignalingCandidate | null): void => {
 *                 if (!candidate) resolve()
 *             })
 *         })
 *         return connection.localDescription
 *     }
 * }
 * ```
 */
@Autoload()
@Transient()
export class PeerConnection extends Provider {

    /**
     * The STUN and TURN servers.
     */
    @Configurable(DTO.Array().items(DTO.Object({
        urls: DTO.Alternatives(DTO.String(), DTO.Array().items(DTO.String())).required(),
        username: DTO.String().optional(),
        credential: DTO.String().optional()
    })).optional().default([]))
    protected readonly iceServers: SignalingIceServer[]

    /**
     * `all`, or `relay` to use only the TURN relays.
     */
    @Configurable(DTO.String().valid('all', 'relay').optional().default('all'))
    protected readonly iceTransportPolicy: 'all' | 'relay'

    /**
     * The UDP ports of the local candidates.
     */
    @Configurable(DTO.Array().items(DTO.Number().port()).length(2).optional())
    protected readonly icePortRange?: [number, number]

    /**
     * More addresses given as local candidates.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly iceAdditionalHostAddresses?: string[]

    /**
     * Whether to gather IPv4 candidates.
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly iceUseIpv4: boolean

    /**
     * Whether to gather IPv6 candidates.
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly iceUseIpv6: boolean

    readonly #events: Events = new Events(this)

    readonly #channels: WeakMap<RTCDataChannel, PeerChannel> = new WeakMap()

    #connection: RTCPeerConnection

    #closed: boolean = false

    /**
     * Create the connection.
     * @protected
     */
    protected async init(): Promise<void> {
        const config: RTCPeerConnectionConfig = {
            iceServers: this.iceServers,
            iceTransportPolicy: this.iceTransportPolicy,
            iceUseIpv4: this.iceUseIpv4,
            iceUseIpv6: this.iceUseIpv6,
            //The largest message the other peer may send, as Chrome accepts (below the SCTP window of 1 MiB)
            maxMessageSize: 262144
        }
        if (this.icePortRange) config.icePortRange = this.icePortRange
        if (this.iceAdditionalHostAddresses) config.iceAdditionalHostAddresses = this.iceAdditionalHostAddresses
        const connection: RTCPeerConnection = new RTCPeerConnection(config)
        this.#connection = connection
        connection.onIceCandidate.subscribe((candidate: SignalingCandidate | undefined): void => {
            const iceCandidate: IceCandidate | null = candidate ? new IceCandidate(candidate) : null
            this.#fire('icecandidate', {candidate: iceCandidate}, iceCandidate ? iceCandidate.toJSON() : null)
        })
        connection.onDataChannel.subscribe((channel: RTCDataChannel): void => {
            const wrapped: PeerChannel = this.#wrap(channel)
            this.#fire('datachannel', {channel: wrapped}, wrapped)
        })
        connection.onNegotiationneeded.subscribe((): void => this.#fire('negotiationneeded', {}))
        connection.connectionStateChange.subscribe((state: string): void => this.#fire('connectionstatechange', {}, state))
        connection.iceConnectionStateChange.subscribe((state: string): void => this.#fire('iceconnectionstatechange', {}, state))
        connection.iceGatheringStateChange.subscribe((state: string): void => this.#fire('icegatheringstatechange', {}, state))
        connection.signalingStateChange.subscribe((state: string): void => this.#fire('signalingstatechange', {}, state))
    }

    /**
     * Close the connection.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#closed = true
        await this.#connection?.close()
    }

    /**
     * `new`, `connecting`, `connected`, `disconnected`, `failed` or `closed`.
     */
    public get connectionState(): 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' {
        return this.#connection.connectionState
    }

    /**
     * The state of ICE: `new`, `checking`, `connected`, `completed`, `disconnected`, `failed` or `closed`.
     */
    public get iceConnectionState(): string {
        return this.#connection.iceConnectionState
    }

    /**
     * The state of the gathering of the local candidates: `new`, `gathering` or `complete`.
     */
    public get iceGatheringState(): string {
        return this.#connection.iceGatheringState
    }

    /**
     * The state of the offer and answer exchange: `stable`, `have-local-offer`, `have-remote-offer`,
     * `have-local-pranswer`, `have-remote-pranswer` or `closed`.
     */
    public get signalingState(): string {
        return this.#connection.signalingState
    }

    /**
     * The local description: the pending one during a negotiation, else the current one.
     */
    public get localDescription(): SignalingDescription | null {
        return plainDescription(this.#connection.localDescription)
    }

    /**
     * The remote description: the pending one during a negotiation, else the current one.
     */
    public get remoteDescription(): SignalingDescription | null {
        return plainDescription(this.#connection.remoteDescription)
    }

    /**
     * The SCTP transport of the data channels, once negotiated: `maxMessageSize` is the largest message the other peer
     * accepts, in bytes.
     */
    public get sctp(): {maxMessageSize: number} | null {
        const transport: {remoteMaxMessageSize: number} | undefined = this.#connection.sctpTransport as {remoteMaxMessageSize: number} | undefined
        return transport ? {maxMessageSize: transport.remoteMaxMessageSize} : null
    }

    /**
     * The listener of `icecandidate`, given an event whose `candidate` is the candidate (`null` at the end).
     */
    public get onicecandidate(): DOMEventListener | null {
        return this.#events.handler('icecandidate')
    }

    public set onicecandidate(listener: DOMEventListener | null) {
        this.#events.setHandler('icecandidate', listener)
    }

    /**
     * The listener of `datachannel`, given an event whose `channel` is the {@link PeerChannel}.
     */
    public get ondatachannel(): DOMEventListener | null {
        return this.#events.handler('datachannel')
    }

    public set ondatachannel(listener: DOMEventListener | null) {
        this.#events.setHandler('datachannel', listener)
    }

    /**
     * The listener of `negotiationneeded`.
     */
    public get onnegotiationneeded(): DOMEventListener | null {
        return this.#events.handler('negotiationneeded')
    }

    public set onnegotiationneeded(listener: DOMEventListener | null) {
        this.#events.setHandler('negotiationneeded', listener)
    }

    /**
     * The listener of `connectionstatechange`.
     */
    public get onconnectionstatechange(): DOMEventListener | null {
        return this.#events.handler('connectionstatechange')
    }

    public set onconnectionstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('connectionstatechange', listener)
    }

    /**
     * The listener of `iceconnectionstatechange`.
     */
    public get oniceconnectionstatechange(): DOMEventListener | null {
        return this.#events.handler('iceconnectionstatechange')
    }

    public set oniceconnectionstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('iceconnectionstatechange', listener)
    }

    /**
     * The listener of `icegatheringstatechange`.
     */
    public get onicegatheringstatechange(): DOMEventListener | null {
        return this.#events.handler('icegatheringstatechange')
    }

    public set onicegatheringstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('icegatheringstatechange', listener)
    }

    /**
     * The listener of `signalingstatechange`.
     */
    public get onsignalingstatechange(): DOMEventListener | null {
        return this.#events.handler('signalingstatechange')
    }

    public set onsignalingstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('signalingstatechange', listener)
    }

    /**
     * Create an offer.
     * @param options `iceRestart` to gather new candidates.
     * @returns The offer, to give to `setLocalDescription()`.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingDescription} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const offer: SignalingDescription = await connection.createOffer()
     * await connection.setLocalDescription(offer)
     * ```
     */
    public async createOffer(options: {iceRestart?: boolean} = {}): Promise<SignalingDescription> {
        return plainDescription(await this.#connection.createOffer(options))!
    }

    /**
     * Create an answer to the remote offer.
     * @returns The answer, to give to `setLocalDescription()`.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingDescription} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const offer: SignalingDescription
     * await connection.setRemoteDescription(offer)
     * await connection.setLocalDescription(await connection.createAnswer())
     * ```
     */
    public async createAnswer(): Promise<SignalingDescription> {
        return plainDescription(await this.#connection.createAnswer())!
    }

    /**
     * Set the local description; without one, the offer or the answer the state calls for is created.
     * @param description The offer, the answer, a rollback, or none.
     * @returns Resolves once it is set.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * await connection.setLocalDescription()
     * console.log(connection.localDescription)
     * ```
     */
    public async setLocalDescription(description?: SignalingDescription): Promise<void> {
        await this.#connection.setLocalDescription(description as never)
    }

    /**
     * Set the remote description; an offer received while an offer of this side is pending rolls it back.
     * @param description The offer or the answer of the other peer.
     * @returns Resolves once it is set.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingDescription} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const answer: SignalingDescription
     * await connection.setRemoteDescription(answer)
     * ```
     */
    public async setRemoteDescription(description: SignalingDescription): Promise<void> {
        await this.#connection.setRemoteDescription(description as never)
    }

    /**
     * Add a candidate of the other peer.
     * @param candidate The candidate; none, or an empty one, for the end of the candidates.
     * @returns Resolves once it is added.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingCandidate} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const candidate: SignalingCandidate
     * await connection.addIceCandidate(candidate)
     * ```
     */
    public async addIceCandidate(candidate?: SignalingCandidate | null): Promise<void> {
        if (!candidate?.candidate) return
        await this.#connection.addIceCandidate({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? undefined,
            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
            usernameFragment: candidate.usernameFragment ?? undefined
        })
    }

    /**
     * Create a data channel; the first one makes the connection negotiate (`negotiationneeded`).
     * @param label The label of the channel.
     * @param options Whether it is ordered, reliable, negotiated.
     * @returns The channel.
     * @example
     * ```typescript
     * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * //Unordered and unreliable: a lost position is not sent again
     * const channel: PeerChannel = connection.createDataChannel('position', {ordered: false, maxRetransmits: 0})
     * ```
     */
    public createDataChannel(label: string, options: DataChannelOptions = {}): PeerChannel {
        return this.#wrap(this.#connection.createDataChannel(label, options))
    }

    /**
     * Restart ICE: the next offer gathers new candidates (`negotiationneeded` fires), for a connection whose network
     * changed.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.on('connectionstatechange', (state: string): void => {
     *     if (state === 'failed') connection.restartIce()
     * })
     * ```
     */
    public restartIce(): void {
        this.#connection.restartIce()
    }

    /**
     * The configuration.
     * @returns The ICE servers and the transport policy.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * console.log(connection.getConfiguration().iceServers)
     * ```
     */
    public getConfiguration(): {iceServers: SignalingIceServer[], iceTransportPolicy: 'all' | 'relay'} {
        const config: {iceServers: SignalingIceServer[], iceTransportPolicy: 'all' | 'relay'} = this.#connection.getConfiguration()
        return {iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy}
    }

    /**
     * Change the ICE servers (new TURN credentials) or the transport policy; they are used from the next gathering.
     * @param configuration The ICE servers, the transport policy.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.setConfiguration({iceServers: [{urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p'}]})
     * ```
     */
    public setConfiguration(configuration: {iceServers?: SignalingIceServer[], iceTransportPolicy?: 'all' | 'relay'}): void {
        const config: RTCPeerConnectionConfig = {}
        if (configuration.iceServers) config.iceServers = configuration.iceServers
        if (configuration.iceTransportPolicy) config.iceTransportPolicy = configuration.iceTransportPolicy
        this.#connection.setConfiguration(config)
    }

    /**
     * Close the connection and its channels, and destroy the object.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.close()
     * ```
     */
    public close(): void {
        if (this.#closed) return
        this.#closed = true
        this.#connection.close().catch((): void => undefined)
        void this.dispose().catch((): void => undefined)
    }

    /**
     * Add a listener of an event, given an event object (the W3C style).
     * @param type The event: `icecandidate`, `datachannel`, `negotiationneeded`, `connectionstatechange`,
     * `iceconnectionstatechange`, `icegatheringstatechange`, `signalingstatechange`.
     * @param listener The listener.
     * @param options `once`, `signal`.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingCandidate} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.addEventListener('icecandidate', (event: {candidate: SignalingCandidate | null}): void => console.log(event.candidate))
     * ```
     */
    public addEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#events.addEventListener(type, listener, options)
    }

    /**
     * Remove a listener added with `addEventListener`.
     * @param type The event.
     * @param listener The listener.
     * @param options `capture`.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const listener = (): void => console.log(connection.connectionState)
     * connection.addEventListener('connectionstatechange', listener)
     * connection.removeEventListener('connectionstatechange', listener)
     * ```
     */
    public removeEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#events.removeEventListener(type, listener, options)
    }

    /**
     * Add a listener of an event, given the value of the event (the Node.js style).
     * @param event The event.
     * @param listener The listener: given the candidate, the channel, the new state.
     * @returns The connection.
     * @example
     * ```typescript
     * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.on('datachannel', (channel: PeerChannel): void => console.log(channel.label))
     * ```
     */
    public on<Event extends keyof PeerConnectionEvents>(event: Event, listener: (...args: PeerConnectionEvents[Event]) => void): this {
        this.#events.on(event, listener)
        return this
    }

    /**
     * Add a listener of the next emission of an event, given the value of the event.
     * @param event The event.
     * @param listener The listener.
     * @returns The connection.
     * @example
     * ```typescript
     * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.once('datachannel', (channel: PeerChannel): void => console.log(channel.label))
     * ```
     */
    public once<Event extends keyof PeerConnectionEvents>(event: Event, listener: (...args: PeerConnectionEvents[Event]) => void): this {
        this.#events.once(event, listener)
        return this
    }

    /**
     * Remove a listener added with `on` or `once`.
     * @param event The event.
     * @param listener The listener.
     * @returns The connection.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const listener = (state: string): void => console.log(state)
     * connection.on('connectionstatechange', listener)
     * connection.off('connectionstatechange', listener)
     * ```
     */
    public off<Event extends keyof PeerConnectionEvents>(event: Event, listener: (...args: PeerConnectionEvents[Event]) => void): this {
        this.#events.off(event, listener)
        return this
    }

    /**
     * The channel object of a channel of the engine, created once
     * @param channel
     */
    #wrap(channel: RTCDataChannel): PeerChannel {
        let wrapped: PeerChannel | undefined = this.#channels.get(channel)
        if (!wrapped) {
            wrapped = new PeerChannel(channel)
            this.#channels.set(channel, wrapped)
        }
        return wrapped
    }

    /**
     * Fire an event, unless the connection is closed
     * @param type
     * @param properties
     * @param args
     */
    #fire(type: keyof PeerConnectionEvents, properties: Record<string, unknown>, ...args: unknown[]): void {
        if (this.#closed && type !== 'connectionstatechange' && type !== 'iceconnectionstatechange' && type !== 'signalingstatechange') return
        this.#events.fire(type, properties, ...args)
    }
}
