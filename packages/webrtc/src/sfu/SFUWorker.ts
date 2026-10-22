import {format} from 'node:util'
import {parentPort, workerData} from 'node:worker_threads'
import {Container} from '@lakutata/core'
import {setDebugHandler} from '../lib/common/log.js'
import type {RtpPacket as EngineRtpPacket, Extensions} from '../lib/rtp/index.js'
import type {EndpointLeg} from '../peer/Endpoints.js'
import {engineTrackOf, type MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import type {SignalingJoinResult, SignalingPeer, SignalingRole} from '../protocol/SignalingProtocol.js'
import type {SignalingReceiver} from '../signaling/Signaling.js'
import type {SFUTrack} from './SFU.js'
import {type SFUHost, SFURoom} from './SFURoom.js'
import {type SFUFromWorker, type SFUToWorker, SFUWorkerChannel, type SFUWorkerMedia} from './SFUWorkerChannel.js'

/**
 * What a worker thread forwarding rooms is started with
 */
export interface SFUWorkerData {
    //The number of the thread, from 0
    readonly thread: number
    //The options of the connections to the members: the codecs, the ports of the thread, the addresses
    readonly connection: Record<string, unknown>
    //Whether the server selects the tracks of each member (asked to the main thread)
    readonly select: boolean
}

/**
 * The key of several values
 * @param parts
 */
function keyOf(...parts: (string | number)[]): string {
    return parts.join('\n')
}

/**
 * Forward the rooms the main thread opens in this worker thread: each is a SFURoom, whose signaling, hooks and events
 * go through the parent port
 */
export function runSFUWorker(): void {
    if (!parentPort) throw new Error('The media server forwards in a worker thread only')
    const data: SFUWorkerData = workerData as SFUWorkerData
    const container: Container = new Container()
    const rooms: Map<number, SFURoom> = new Map()
    //The receivers of the members of the rooms (by room and member), the legs of WHIP and WHEP, the tracks read by the
    //main thread (by room, member and track)
    const receivers: Map<string, SignalingReceiver> = new Map()
    const legs: Map<string, EndpointLeg & {source?(): string | undefined}> = new Map()
    const streams: Map<string, () => void> = new Map()
    const channel: SFUWorkerChannel<SFUToWorker, SFUFromWorker> = new SFUWorkerChannel(parentPort, (message: SFUToWorker): unknown => handle(message))

    const roomOf = (ref: number): SFURoom => {
        const room: SFURoom | undefined = rooms.get(ref)
        if (!room) throw new Error('The room is not served any more')
        return room
    }

    //A leg of WHIP or WHEP: its end is told to the main thread
    const keep = (id: string, leg: EndpointLeg & {source?(): string | undefined}): void => {
        legs.set(id, leg)
        leg.ended((): void => {
            if (legs.get(id) === leg) legs.delete(id)
            channel.post({type: 'ended', leg: id})
        })
    }

    //The packets of a track sent to the main thread, while they are wanted there
    const stream = (ref: number, peerId: string, trackId: string, wanted: boolean): void => {
        const key: string = keyOf(ref, peerId, trackId)
        streams.get(key)?.()
        streams.delete(key)
        const media: MediaTrack | undefined = wanted ? rooms.get(ref)?.track(peerId, trackId) : undefined
        if (!media) return
        streams.set(key, engineTrackOf(media).onReceiveRtp.subscribe((packet: EngineRtpPacket, extensions?: Extensions): void => {
            //Its own buffer, given to the main thread
            const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(packet.serialize())
            channel.post({type: 'rtp', ref: ref, peerId: peerId, trackId: trackId, packet: bytes, extensions: extensions}, [bytes.buffer])
        }).unSubscribe)
    }

    const hostOf = (ref: number, id: string): SFUHost => ({
        id: id,
        signaling: {
            join: async (peerId: string, _room: string, options: {role: SignalingRole, receive: SignalingReceiver}): Promise<SignalingJoinResult> => {
                receivers.set(keyOf(ref, peerId), options.receive)
                try {
                    return await channel.request<SignalingJoinResult>({type: 'join', ref: ref, peerId: peerId, role: options.role})
                } catch (error) {
                    receivers.delete(keyOf(ref, peerId))
                    throw error
                }
            },
            leave: async (peerId: string): Promise<void> => {
                receivers.delete(keyOf(ref, peerId))
                await channel.request({type: 'leave', ref: ref, peerId: peerId})
            },
            signal: (peerId: string, _room: string, to: string, signal: Parameters<SFUHost['signaling']['signal']>[3]): Promise<boolean> => channel.request<boolean>({type: 'signal', ref: ref, peerId: peerId, to: to, signal: signal})
        },
        connect: (): Promise<PeerConnection> => container.get(PeerConnection, data.connection),
        select: data.select
            ? (subscriber: SignalingPeer, track: SFUTrack): Promise<boolean> => channel.request<boolean>({type: 'select', subscriber: subscriber, track: track})
            : (): boolean => true,
        emit: (event: string, ...args: unknown[]): void => {
            const track: SFUTrack | undefined = event === 'publish' || event === 'unpublish' ? args[0] as SFUTrack : undefined
            //The id and the codec of a track published, for the track read in the main thread
            let published: SFUWorkerMedia | undefined
            const media: MediaTrack | undefined = event === 'publish' && track ? rooms.get(ref)?.track(track.peerId, track.id) : undefined
            if (media) {
                const codec = engineTrackOf(media).codec
                published = {id: media.id, ...codec ? {codec: {payloadType: codec.payloadType, mimeType: codec.mimeType, clockRate: codec.clockRate, channels: codec.channels, parameters: codec.parameters}} : {}}
            }
            if (event === 'unpublish' && track) stream(ref, track.peerId, track.id, false)
            channel.post({type: 'emit', ref: ref, event: event, args: args, ...published ? {media: published} : {}})
        },
        emptied: (): void => channel.post({type: 'emptied', ref: ref}),
        changed: (room: SFURoom): void => channel.post({type: 'state', ref: ref, members: room.members, viewers: room.viewers}),
        sourced: (viewerId: string, source: string | undefined): void => channel.post({type: 'source', leg: viewerId, source: source})
    })

    const handle = async (message: SFUToWorker): Promise<unknown> => {
        switch (message.type) {
            case 'open': {
                const room: SFURoom = new SFURoom(hostOf(message.ref, message.id), message.room)
                rooms.set(message.ref, room)
                try {
                    await room.ready
                } catch (error) {
                    if (rooms.get(message.ref) === room) rooms.delete(message.ref)
                    throw error
                }
                return undefined
            }
            case 'close': {
                const room: SFURoom | undefined = rooms.get(message.ref)
                rooms.delete(message.ref)
                await room?.close()
                return undefined
            }
            case 'publish': {
                const leg: EndpointLeg = await roomOf(message.ref).publish(message.peerId, message.offer)
                keep(message.peerId, leg)
                return {answer: leg.answer}
            }
            case 'play': {
                const viewerId: string = message.viewerId
                const leg: EndpointLeg & {source(): string | undefined} = await roomOf(message.ref).play(viewerId, message.offer, message.select
                    ? (tracks: SFUTrack[]): Promise<string | undefined> => channel.request<string | undefined>({type: 'choose', leg: viewerId, tracks: tracks})
                    : undefined)
                keep(viewerId, leg)
                return {answer: leg.answer, source: leg.source()}
            }
            case 'patch': {
                const leg: EndpointLeg | undefined = legs.get(message.leg)
                if (!leg) throw new Error('There is no such session')
                return await leg.patch(message.fragment, message.restart)
            }
            case 'end':
                return legs.get(message.leg)?.close()
            case 'receive':
                return receivers.get(keyOf(message.ref, message.peerId))?.(message.event, message.payload)
            case 'stream':
                return stream(message.ref, message.peerId, message.trackId, message.wanted)
            case 'keyframe':
                return rooms.get(message.ref)?.track(message.peerId, message.trackId)?.requestKeyFrame()
            case 'debug':
                //The debug messages go to the handler of the main thread while it has one
                return setDebugHandler(message.enabled
                    ? (namespace: string, args: unknown[]): void => channel.post({type: 'log', namespace: namespace, message: `[thread ${data.thread}] ${format(...args)}`})
                    : undefined)
            case 'stop': {
                const closing: SFURoom[] = [...rooms.values()]
                rooms.clear()
                await Promise.all(closing.map((room: SFURoom): Promise<void> => room.close()))
                await container.destroy()
                return undefined
            }
        }
    }

    channel.post({type: 'ready'})
}
