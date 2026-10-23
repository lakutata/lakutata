import {format} from 'node:util'
import {parentPort, workerData} from 'node:worker_threads'
import {getDataChannelMessageSize, type RTCDataChannel} from '../lib/peer/dataChannel.js'
import {RTCRtpCodecParameters} from '../lib/peer/media/parameters.js'
import type {RTCRtpReceiver} from '../lib/peer/media/rtpReceiver.js'
import type {MediaDirection, RTCRtpTransceiver} from '../lib/peer/media/rtpTransceiver.js'
import {MediaStream, MediaStreamTrack} from '../lib/peer/media/track.js'
import {RTCPeerConnection, type RTCTrackEvent} from '../lib/peer/peerConnection.js'
import type {RTCIceCandidate} from '../lib/peer/transport/ice.js'
import {type Extensions, RtpPacket} from '../lib/rtp/index.js'
import type {SignalingCandidate, SignalingDescription} from '../protocol/SignalingProtocol.js'
import {engineConfigOf} from './EngineConfig.js'
import {debug, setDebugHandler} from '../lib/common/log.js'
import {PeerThreadChannel, type PeerThreadPort, RTP_IN_FLIGHT, sentError} from './PeerThreadChannel.js'
import type {
    PeerChannelInfo,
    PeerCodec,
    PeerConnectionState,
    PeerFromWorker,
    PeerToWorker,
    PeerTrackInfo,
    PeerTransceiverChange,
    PeerTransceiverInfo,
    PeerWorkerData
} from './PeerThreadProtocol.js'
import type {RtpTransceiverDirection} from './RtpTransceiver.js'

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
 * A track received by a connection served here
 */
interface Received {
    readonly track: MediaStreamTrack
    readonly receiver: RTCRtpReceiver
    //Its packets go to the main thread while wanted there
    unsubscribe?: () => void
}

/**
 * A connection served here, with its channels, its transceivers and its tracks
 */
interface Served {
    readonly conn: number
    readonly engine: RTCPeerConnection
    readonly channels: Map<string, Channel>
    //The channels whose buffered amount changed during this turn of the event loop
    readonly changed: Set<Channel>
    readonly transceivers: Map<string, RTCRtpTransceiver>
    readonly transceiverRefs: WeakMap<RTCRtpTransceiver, string>
    //The copies of the tracks of the main thread it sends, by their references there
    readonly mirrors: Map<string, MediaStreamTrack>
    readonly mirrorRefs: WeakMap<MediaStreamTrack, string>
    readonly received: Map<string, Received>
    readonly receivedRefs: WeakMap<MediaStreamTrack, string>
    next: number
    //The last change of the transceivers by the main thread done
    ops: number
    //The states read so far
    seq: number
    //The bytes of the RTP packets on their way to the main thread
    rtpOut: number
    //The bytes of the RTP packets of the main thread read since the last report
    rtpRead: number
}

/**
 * A plain description
 * @param description
 */
function plainDescription(description: {type: string, sdp: string} | undefined | null): SignalingDescription | null {
    return description ? {type: description.type as SignalingDescription['type'], sdp: description.sdp} : null
}

/**
 * A codec as plain data
 * @param codec
 */
function plainCodec(codec: RTCRtpCodecParameters): PeerCodec {
    return {
        payloadType: codec.payloadType,
        mimeType: codec.mimeType,
        clockRate: codec.clockRate,
        channels: codec.channels,
        parameters: codec.parameters,
        rtcpFeedback: codec.rtcpFeedback.map((feedback: {type: string, parameter?: string}): {type: string, parameter?: string} => ({type: feedback.type, parameter: feedback.parameter}))
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

const log = debug('webrtc/peer/threads')

/**
 * Serve the connections the main thread opens in this worker thread (the `threads` option of a connection): their
 * engines run here, their methods are called from the main thread, their events, their state, the messages of their
 * channels and the packets of the tracks received go to it, the packets of the tracks sent come from it
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
    //A track received, known to the main thread by its reference; its end is told there
    const receivedRef = (served: Served, track: MediaStreamTrack, receiver: RTCRtpReceiver): string => {
        let ref: string | undefined = served.receivedRefs.get(track)
        if (ref) return ref
        ref = `r${served.next++}`
        served.receivedRefs.set(track, ref)
        served.received.set(ref, {track: track, receiver: receiver})
        const known: string = ref
        track.once('ended', (): void => {
            served.received.get(known)?.unsubscribe?.()
            served.received.delete(known)
            channel.post({type: 'trackEnded', conn: served.conn, track: known})
        })
        return ref
    }
    //A transceiver, known to the main thread by its reference: the key frame requests of its sender are told there
    const transceiverRef = (served: Served, transceiver: RTCRtpTransceiver, given?: string): string => {
        let ref: string | undefined = served.transceiverRefs.get(transceiver)
        if (ref) return ref
        ref = given ?? `w${served.next++}`
        served.transceiverRefs.set(transceiver, ref)
        served.transceivers.set(ref, transceiver)
        const known: string = ref
        transceiver.sender.onPictureLossIndication.subscribe((): void => channel.post({type: 'pli', conn: served.conn, transceiver: known}))
        return ref
    }
    const transceiverInfo = (served: Served, transceiver: RTCRtpTransceiver): PeerTransceiverInfo => {
        const received: MediaStreamTrack = transceiver.receiver.track
        const receiving: PeerTrackInfo = {
            ref: receivedRef(served, received, transceiver.receiver),
            kind: received.kind as 'audio' | 'video',
            id: received.id ?? received.uuid,
            ...received.codec ? {codec: plainCodec(received.codec)} : {}
        }
        const sent: MediaStreamTrack | null | undefined = transceiver.sender.track
        return {
            ref: transceiverRef(served, transceiver),
            kind: transceiver.kind as 'audio' | 'video',
            mid: transceiver.mid,
            direction: transceiver.direction as RtpTransceiverDirection,
            currentDirection: transceiver.currentDirection as RtpTransceiverDirection | 'stopped' | null,
            reusable: served.engine.reusableForTrack(transceiver),
            sending: sent ? served.mirrorRefs.get(sent) ?? null : null,
            ...sent?.codec ? {sendingCodec: plainCodec(sent.codec)} : {},
            receiving: receiving
        }
    }
    //The state of a connection, as the main thread reads it
    const stateOf = (served: Served): PeerConnectionState => {
        const engine: RTCPeerConnection = served.engine
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
            configuration: {iceServers: configuration.iceServers, iceTransportPolicy: configuration.iceTransportPolicy},
            transceivers: engine.getTransceivers().map((transceiver: RTCRtpTransceiver): PeerTransceiverInfo => transceiverInfo(served, transceiver)),
            ops: served.ops,
            seq: ++served.seq
        }
    }
    //A channel of a connection, its events sent to the main thread
    const adopt = (served: Served, engine: RTCDataChannel, ref: string): Channel => {
        const adopted: Channel = {ref: ref, engine: engine, applied: 0}
        served.channels.set(ref, adopted)
        engine.stateChanged.subscribe((readyState: PeerChannelInfo['readyState']): void => {
            channel.post({type: 'channelState', conn: served.conn, ch: ref, readyState: readyState, id: engine.id ?? null})
            if (readyState === 'closed') served.channels.delete(ref)
        })
        engine.onMessage.subscribe((message: string | Buffer): void => {
            //Out of the receive window until the main thread reads it: a main thread reading slowly slows the sender
            served.engine.sctpTransport?.holdReceived(getDataChannelMessageSize(message))
            //A copy: the buffer of the engine may hold other values (a buffer of the pool of Node.js, a datagram)
            const {bytes, transfer} = typeof message === 'string' ? {bytes: message, transfer: undefined} : channel.pack(message)
            //With the messages of the channel received just before
            channel.postOrExtend(
                (last: PeerFromWorker): boolean => last.type === 'message' && last.conn === served.conn && last.ch === ref && last.data.push(bytes) > 0,
                (): PeerFromWorker => ({type: 'message', conn: served.conn, ch: ref, data: [bytes]}),
                transfer
            )
        })
        engine.bufferedAmountChanged.subscribe((): void => {
            served.changed.add(adopted)
            channel.schedule()
        })
        engine.error.subscribe((error: Error): void => channel.post({type: 'channelError', conn: served.conn, ch: ref, error: sentError(error)}))
        return adopted
    }
    const open = (conn: number, engine: RTCPeerConnection): Served => {
        const served: Served = {
            conn: conn,
            engine: engine,
            channels: new Map(),
            changed: new Set(),
            transceivers: new Map(),
            transceiverRefs: new WeakMap(),
            mirrors: new Map(),
            mirrorRefs: new WeakMap(),
            received: new Map(),
            receivedRefs: new WeakMap(),
            next: 1,
            ops: 0,
            seq: 0,
            rtpOut: 0,
            rtpRead: 0
        }
        connections.set(conn, served)
        engine.onIceCandidate.subscribe((candidate: RTCIceCandidate | undefined): void => {
            const plain: SignalingCandidate | null = candidate
                ? {candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null, usernameFragment: candidate.usernameFragment ?? null}
                : null
            channel.post({type: 'event', conn: conn, name: 'icecandidate', candidate: plain, state: stateOf(served)})
        })
        engine.onDataChannel.subscribe((created: RTCDataChannel): void => {
            const ref: string = `w${served.next++}`
            adopt(served, created, ref)
            channel.post({type: 'datachannel', conn: conn, ch: ref, info: infoOf(created)})
        })
        engine.on('track', (event: RTCTrackEvent): void => {
            channel.post({
                type: 'track',
                conn: conn,
                transceiver: transceiverInfo(served, event.transceiver),
                streams: event.streams.map((stream: MediaStream): string => stream.id),
                state: stateOf(served)
            })
        })
        engine.onNegotiationneeded.subscribe((): void => channel.post({type: 'event', conn: conn, name: 'negotiationneeded', state: stateOf(served)}))
        engine.connectionStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'connectionstatechange', value: value, state: stateOf(served)}))
        engine.iceConnectionStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'iceconnectionstatechange', value: value, state: stateOf(served)}))
        engine.iceGatheringStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'icegatheringstatechange', value: value, state: stateOf(served)}))
        engine.signalingStateChange.subscribe((value: string): void => channel.post({type: 'event', conn: conn, name: 'signalingstatechange', value: value, state: stateOf(served)}))
        return served
    }
    const mirrorOf = (served: Served, ref: string): MediaStreamTrack => {
        const mirror: MediaStreamTrack | undefined = served.mirrors.get(ref)
        if (!mirror) throw new Error(`The track ${ref} is not known`)
        return mirror
    }
    const transceiverOf = (served: Served, ref: string): RTCRtpTransceiver => {
        const transceiver: RTCRtpTransceiver | undefined = served.transceivers.get(ref)
        if (!transceiver) throw new Error(`The transceiver ${ref} is not known`)
        return transceiver
    }
    //A change of the transceivers by the main thread, then the state it makes, with its number
    const change = async (served: Served, message: PeerTransceiverChange): Promise<void> => {
        const streams = (ids: string[]): MediaStream[] => ids.map((id: string): MediaStream => new MediaStream({id: id}))
        try {
            switch (message.type) {
                case 'addTrack': {
                    const chosen: RTCRtpTransceiver | null = message.transceiver === null ? null : served.transceivers.get(message.transceiver) ?? null
                    const sender = served.engine.addTrackOn(chosen, mirrorOf(served, message.track), ...streams(message.streams))
                    const added: RTCRtpTransceiver | undefined = served.engine.getTransceivers().find((transceiver: RTCRtpTransceiver): boolean => transceiver.sender === sender)
                    if (added) transceiverRef(served, added, message.created)
                    break
                }
                case 'addTransceiver': {
                    const added: RTCRtpTransceiver = served.engine.addTransceiver(message.track === undefined ? message.kind : mirrorOf(served, message.track), {
                        direction: message.direction as MediaDirection,
                        streams: streams(message.streams)
                    })
                    transceiverRef(served, added, message.created)
                    break
                }
                case 'removeTrack':
                    served.engine.removeTrack(transceiverOf(served, message.transceiver).sender)
                    break
                case 'direction':
                    transceiverOf(served, message.transceiver).direction = message.direction as MediaDirection
                    break
                case 'stopTransceiver':
                    transceiverOf(served, message.transceiver).stop()
                    break
                case 'replaceTrack':
                    await transceiverOf(served, message.transceiver).sender.replaceTrack(message.track === null ? null : mirrorOf(served, message.track))
                    break
                case 'setStreams':
                    transceiverOf(served, message.transceiver).sender.setStreams(streams(message.streams))
                    break
            }
        } finally {
            served.ops = Math.max(served.ops, message.op)
            channel.post({type: 'state', conn: served.conn, state: stateOf(served)})
        }
    }
    const handle = async (message: PeerToWorker): Promise<unknown> => {
        switch (message.type) {
            case 'open': {
                const served: Served = open(message.conn, new RTCPeerConnection(engineConfigOf(message.options)))
                return stateOf(served)
            }
            case 'call': {
                const served: Served = servedOf(message.conn)
                const engine: RTCPeerConnection = served.engine
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
                return {result: result, state: stateOf(served)}
            }
            case 'close': {
                const served: Served | undefined = connections.get(message.conn)
                if (!served) return undefined
                await served.engine.close()
                for (const mirror of served.mirrors.values()) mirror.stop()
                //The last events of the connection are sent before the reply
                connections.delete(message.conn)
                return stateOf(served)
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
                served.changed.add(target)
                for (const data of message.data) {
                    const payload: string | Buffer = typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
                    target.applied += getDataChannelMessageSize(payload)
                    try {
                        target.engine.send(payload)
                    } catch (error) {
                        //Closed meanwhile, or too large for the other peer: the error of the channel
                        channel.post({type: 'channelError', conn: message.conn, ch: message.ch, error: sentError(error)})
                    }
                }
                return undefined
            }
            case 'closeChannel':
                return connections.get(message.conn)?.channels.get(message.ch)?.engine.close()
            case 'mirror': {
                const served: Served = servedOf(message.conn)
                const mirror: MediaStreamTrack = new MediaStreamTrack({
                    kind: message.kind,
                    id: message.id,
                    remote: message.remote,
                    ...message.codec ? {codec: new RTCRtpCodecParameters(message.codec)} : {}
                })
                served.mirrors.set(message.track, mirror)
                served.mirrorRefs.set(mirror, message.track)
                return undefined
            }
            case 'rtp': {
                const served: Served | undefined = connections.get(message.conn)
                if (!served) return undefined
                const mirror: MediaStreamTrack | undefined = served.mirrors.get(message.track)
                //What was read, told at the end of the turn of the event loop
                if (!served.rtpRead) {
                    setImmediate((): void => {
                        channel.post({type: 'consumed', conn: served.conn, rtp: served.rtpRead})
                        served.rtpRead = 0
                    })
                }
                for (const bytes of message.packets) served.rtpRead += bytes.byteLength
                message.packets.forEach((bytes: Uint8Array, index: number): void => {
                    mirror?.applyIncomingRtp(RtpPacket.deSerialize(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)), message.extensions[index] ?? undefined)
                })
                return undefined
            }
            case 'consumed': {
                const served: Served | undefined = connections.get(message.conn)
                if (!served) return undefined
                served.rtpOut -= message.rtp
                if (message.bytes) served.engine.sctpTransport?.releaseReceived(message.bytes)
                return undefined
            }
            case 'source':
                return connections.get(message.conn)?.mirrors.get(message.track)?.onSourceChanged.execute(message.header)
            case 'mirrorEnded':
                return connections.get(message.conn)?.mirrors.get(message.track)?.stop()
            case 'dropTrack': {
                const served: Served | undefined = connections.get(message.conn)
                served?.mirrors.get(message.track)?.stop()
                served?.mirrors.delete(message.track)
                return undefined
            }
            case 'addTrack':
            case 'addTransceiver':
            case 'removeTrack':
            case 'direction':
            case 'stopTransceiver':
            case 'replaceTrack':
            case 'setStreams':
                //replaceTrack is a request: it resolves once the sender sends the new track
                return await change(servedOf(message.conn), message)
            case 'keyframe': {
                const received: Received | undefined = connections.get(message.conn)?.received.get(message.track)
                const ssrc: number | undefined = received?.track.ssrc
                if (received && ssrc !== undefined) void received.receiver.sendRtcpPLI(ssrc)
                return undefined
            }
            case 'want': {
                const served: Served | undefined = connections.get(message.conn)
                const received: Received | undefined = served?.received.get(message.track)
                if (!served || !received) return undefined
                received.unsubscribe?.()
                received.unsubscribe = undefined
                if (message.wanted) {
                    const ref: string = message.track
                    received.unsubscribe = received.track.onReceiveRtp.subscribe((packet: RtpPacket, extensions?: Extensions): void => {
                        const serialized: Buffer = packet.serialize()
                        //The main thread reads too slowly: dropped, as by a full UDP buffer
                        if (served.rtpOut + serialized.length > RTP_IN_FLIGHT) return log('a packet of the track %s dropped: the main thread reads too slowly', ref)
                        served.rtpOut += serialized.length
                        const {bytes, transfer} = channel.pack(serialized)
                        //With the packets of the track received just before
                        channel.postOrExtend(
                            (last: PeerFromWorker): boolean => last.type === 'rtp' && last.conn === served.conn && last.track === ref && last.packets.push(bytes) > 0 && last.extensions.push(extensions ?? null) > 0,
                            (): PeerFromWorker => ({type: 'rtp', conn: served.conn, track: ref, packets: [bytes], extensions: [extensions ?? null]}),
                            transfer
                        )
                    }).unSubscribe
                }
                return undefined
            }
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
