import {format} from 'node:util'
import {parentPort, workerData} from 'node:worker_threads'
import {setDebugHandler} from '../lib/common/log.js'
import {getDataChannelMessageSize, type RTCDataChannel} from '../lib/peer/dataChannel.js'
import {RTCPeerConnection} from '../lib/peer/peerConnection.js'
import type {RTCIceCandidate} from '../lib/peer/transport/ice.js'
import type {SignalingCandidate, SignalingDescription} from '../protocol/SignalingProtocol.js'
import {engineConfigOf} from './EngineConfig.js'
import {PeerThreadChannel, type PeerThreadPort, sentError} from './PeerThreadChannel.js'
import type {PeerChannelInfo, PeerConnectionState, PeerFromWorker, PeerToWorker, PeerWorkerData} from './PeerThreadProtocol.js'

/**
 * A data channel of a connection served here
 */
interface Channel {
    readonly ref: string
    readonly engine: RTCDataChannel
    //The bytes of the messages of the main thread given to the engine so far
    applied: number
}

/**
 * A connection served here, with its channels
 */
interface Served {
    readonly conn: number
    readonly engine: RTCPeerConnection
    readonly channels: Map<string, Channel>
    readonly refs: WeakMap<RTCDataChannel, string>
    //The channels whose buffered amount changed during this turn of the event loop
    readonly changed: Set<Channel>
    nextChannel: number
}

/**
 * A plain description
 * @param description
 */
function plainDescription(description: {type: string, sdp: string} | undefined | null): SignalingDescription | null {
    return description ? {type: description.type as SignalingDescription['type'], sdp: description.sdp} : null
}

/**
 * The state of a connection, as the main thread reads it
 * @param engine
 */
function stateOf(engine: RTCPeerConnection): PeerConnectionState {
    const sctp: {remoteMaxMessageSize: number} | undefined = engine.sctpTransport as {remoteMaxMessageSize: number} | undefined
    const configuration = engine.getConfiguration()
    return {
        connectionState: engine.connectionState,
        iceConnectionState: engine.iceConnectionState,
        iceGatheringState: engine.iceGatheringState,
        signalingState: engine.signalingState,
        localDescription: plainDescription(engine.localDescription),
        remoteDescription: plainDescription(engine.remoteDescription),
        maxMessageSize: sctp ? sctp.remoteMaxMessageSize : null,
        configuration: {iceServers: configuration.iceServers, iceTransportPolicy: configuration.iceTransportPolicy}
    }
}

/**
 * What the main thread knows of a channel
 * @param engine
 */
function infoOf(engine: RTCDataChannel): PeerChannelInfo {
    return {
        label: engine.label,
        protocol: engine.protocol,
        ordered: engine.ordered,
        maxRetransmits: engine.maxRetransmits,
        maxPacketLifeTime: engine.maxPacketLifeTime,
        negotiated: engine.negotiated,
        id: engine.id ?? null,
        readyState: engine.readyState
    }
}

/**
 * The bytes of a message, as sent to the main thread: a copy, transferred (the buffer of the engine may hold other
 * values: a buffer of the pool of Node.js, a datagram)
 * @param data
 */
function sentBytes(data: Buffer): {bytes: Uint8Array, transfer: ArrayBuffer[]} {
    const bytes: Uint8Array = new Uint8Array(data)
    return {bytes: bytes, transfer: [bytes.buffer as ArrayBuffer]}
}

/**
 * Serve the connections the main thread opens in this worker thread (the `threads` option of a connection): their
 * engines run here, their methods are called from the main thread, their events, their state and the messages of their
 * channels go to it
 */
export function runPeerWorker(): void {
    if (!parentPort) throw new Error('The connections of a thread are served in a worker thread only')
    const data: PeerWorkerData = workerData as PeerWorkerData
    const connections: Map<number, Served> = new Map()
    const channel: PeerThreadChannel<PeerFromWorker, PeerToWorker> = new PeerThreadChannel(parentPort as PeerThreadPort, (message: PeerToWorker): unknown => handle(message))
    //The amounts buffered that changed, one report per channel and turn of the event loop
    channel.beforeSending((): void => {
        for (const served of connections.values()) {
            for (const changed of served.changed) channel.post({type: 'buffered', conn: served.conn, ch: changed.ref, amount: changed.engine.bufferedAmount, applied: changed.applied})
            served.changed.clear()
        }
    })
    const servedOf = (conn: number): Served => {
        const served: Served | undefined = connections.get(conn)
        if (!served) throw Object.assign(new Error('The connection is closed'), {name: 'InvalidStateError'})
        return served
    }
    //A channel of a connection, its events sent to the main thread
    const adopt = (served: Served, engine: RTCDataChannel, ref: string): Channel => {
        const adopted: Channel = {ref: ref, engine: engine, applied: 0}
        served.channels.set(ref, adopted)
        served.refs.set(engine, ref)
        engine.stateChanged.subscribe((readyState: PeerChannelInfo['readyState']): void => {
            channel.post({type: 'channelState', conn: served.conn, ch: ref, readyState: readyState, id: engine.id ?? null})
            if (readyState === 'closed') served.channels.delete(ref)
        })
        engine.onMessage.subscribe((message: string | Buffer): void => {
            if (typeof message === 'string') return channel.post({type: 'message', conn: served.conn, ch: ref, data: message})
            const {bytes, transfer} = sentBytes(message)
            channel.post({type: 'message', conn: served.conn, ch: ref, data: bytes}, transfer)
        })
        engine.bufferedAmountChanged.subscribe((): void => {
            served.changed.add(adopted)
            channel.schedule()
        })
        engine.error.subscribe((error: Error): void => channel.post({type: 'channelError', conn: served.conn, ch: ref, error: sentError(error)}))
        return adopted
    }
    const open = (conn: number, engine: RTCPeerConnection): Served => {
        const served: Served = {conn: conn, engine: engine, channels: new Map(), refs: new WeakMap(), changed: new Set(), nextChannel: 1}
        connections.set(conn, served)
        engine.onIceCandidate.subscribe((candidate: RTCIceCandidate | undefined): void => {
            const plain: SignalingCandidate | null = candidate
                ? {candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null, usernameFragment: candidate.usernameFragment ?? null}
                : null
            channel.post({type: 'event', conn: conn, name: 'icecandidate', candidate: plain, state: stateOf(engine)})
        })
        engine.onDataChannel.subscribe((created: RTCDataChannel): void => {
            const ref: string = `w${served.nextChannel++}`
            adopt(served, created, ref)
            channel.post({type: 'datachannel', conn: conn, ch: ref, info: infoOf(created)})
        })
        engine.onNegotiationneeded.subscribe((): void => channel.post({type: 'event', conn: conn, name: 'negotiationneeded', state: stateOf(engine)}))
        engine.connectionStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'connectionstatechange', value: value, state: stateOf(engine)}))
        engine.iceConnectionStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'iceconnectionstatechange', value: value, state: stateOf(engine)}))
        engine.iceGatheringStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'icegatheringstatechange', value: value, state: stateOf(engine)}))
        engine.signalingStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'signalingstatechange', value: value, state: stateOf(engine)}))
        return served
    }
    const handle = async (message: PeerToWorker): Promise<unknown> => {
        switch (message.type) {
            case 'open': {
                const served: Served = open(message.conn, new RTCPeerConnection(engineConfigOf(message.options)))
                return stateOf(served.engine)
            }
            case 'call': {
                const engine: RTCPeerConnection = servedOf(message.conn).engine
                let result: unknown
                switch (message.method) {
                    case 'createOffer':
                        result = plainDescription(await engine.createOffer(message.args[0]))
                        break
                    case 'createAnswer':
                        result = plainDescription(await engine.createAnswer())
                        break
                    case 'setLocalDescription':
                        await engine.setLocalDescription(message.args[0] as never)
                        break
                    case 'setRemoteDescription':
                        await engine.setRemoteDescription(message.args[0] as never)
                        break
                    case 'addIceCandidate': {
                        const candidate: SignalingCandidate = message.args[0]
                        await engine.addIceCandidate({
                            candidate: candidate.candidate,
                            sdpMid: candidate.sdpMid ?? undefined,
                            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
                            usernameFragment: candidate.usernameFragment ?? undefined
                        })
                        break
                    }
                }
                return {result: result, state: stateOf(engine)}
            }
            case 'close': {
                const served: Served | undefined = connections.get(message.conn)
                if (!served) return undefined
                await served.engine.close()
                //The last events of the connection are sent before the reply
                connections.delete(message.conn)
                return stateOf(served.engine)
            }
            case 'restartIce':
                return servedOf(message.conn).engine.restartIce()
            case 'setConfiguration':
                return servedOf(message.conn).engine.setConfiguration(message.configuration)
            case 'channel': {
                const served: Served = servedOf(message.conn)
                let created: RTCDataChannel
                try {
                    created = served.engine.createDataChannel(message.label, message.options)
                } catch (error) {
                    //Created in the main thread already: it fails there, and closes
                    channel.post({type: 'channelError', conn: message.conn, ch: message.ch, error: sentError(error)})
                    channel.post({type: 'channelState', conn: message.conn, ch: message.ch, readyState: 'closed', id: null})
                    return undefined
                }
                adopt(served, created, message.ch)
                //Its id, known once created
                channel.post({type: 'channelState', conn: message.conn, ch: message.ch, readyState: created.readyState, id: created.id ?? null})
                return undefined
            }
            case 'send': {
                const served: Served | undefined = connections.get(message.conn)
                const target: Channel | undefined = served?.channels.get(message.ch)
                if (!served || !target) return undefined
                const payload: string | Buffer = typeof message.data === 'string' ? message.data : Buffer.from(message.data.buffer, message.data.byteOffset, message.data.byteLength)
                target.applied += getDataChannelMessageSize(payload)
                served.changed.add(target)
                try {
                    target.engine.send(payload)
                } catch (error) {
                    //Closed meanwhile, or too large for the other peer: the error of the channel
                    channel.post({type: 'channelError', conn: message.conn, ch: message.ch, error: sentError(error)})
                }
                return undefined
            }
            case 'closeChannel':
                return connections.get(message.conn)?.channels.get(message.ch)?.engine.close()
            case 'debug':
                //The debug messages go to the handler of the main thread while it has one
                return setDebugHandler(message.enabled
                    ? (namespace: string, args: unknown[]): void => channel.post({type: 'log', namespace: namespace, message: `[thread ${data.thread}] ${format(...args)}`})
                    : undefined)
            case 'stop': {
                const closing: Served[] = [...connections.values()]
                connections.clear()
                await Promise.all(closing.map((served: Served): Promise<void> => served.engine.close()))
                return undefined
            }
        }
    }
    channel.post({type: 'ready'})
}
