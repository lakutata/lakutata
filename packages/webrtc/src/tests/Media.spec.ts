import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {engineConnectionOf} from '../peer/EngineConnection.js'
import {MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection, type PeerConnectionOptions, type PeerTrackEvent} from '../peer/PeerConnection.js'
import type {RtpPacket} from '../peer/RtpPacket.js'
import type {RtpSender, RtpTransceiver} from '../peer/RtpTransceiver.js'
import {type Peer, type Room, SignalingClient} from '../peer/SignalingClient.js'
import type {SignalingCandidate} from '../protocol/SignalingProtocol.js'
import {feed, packets} from './support/Media.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

/**
 * The first track the room receives from a member
 * @param room
 * @param from
 */
function trackFrom(room: Room, from: string): Promise<PeerTrackEvent> {
    return next<PeerTrackEvent>((resolve: (event: PeerTrackEvent) => void): void => {
        room.on('peer', (peer: Peer): void => {
            if (peer.id === from) peer.on('track', resolve)
        })
    }, 20000, `the track of ${from}`)
}

/**
 * The header extensions of the media of a description: their URIs by id, for each media
 * @param sdp
 */
function extensionsOf(sdp: string): Record<string, string>[] {
    return sdp.split(/^m=/m).slice(1).map((media: string): Record<string, string> => Object.fromEntries(
        [...media.matchAll(/^a=extmap:(\d+) (\S+)/gm)].map(([, id, uri]: string[]): [string, string] => [id, uri])
    ))
}

/**
 * Two connections exchanging their descriptions and candidates directly, the offerer sending a track
 * @param container
 * @param track
 * @param options The options of both connections
 */
async function directPair(container: Container, track: MediaTrack, options: PeerConnectionOptions): Promise<{offerer: PeerConnection, answerer: PeerConnection, received: PeerTrackEvent}> {
    const offerer: PeerConnection = await container.get(PeerConnection, options)
    const answerer: PeerConnection = await container.get(PeerConnection, options)
    offerer.on('icecandidate', (candidate: SignalingCandidate | null): void => void answerer.addIceCandidate(candidate))
    answerer.on('icecandidate', (candidate: SignalingCandidate | null): void => void offerer.addIceCandidate(candidate))
    const received: Promise<PeerTrackEvent> = next<PeerTrackEvent>((resolve: (event: PeerTrackEvent) => void): void => answerer.addEventListener('track', resolve, {once: true}), 15000, 'the track')
    offerer.addTrack(track)
    await offerer.setLocalDescription()
    await answerer.setRemoteDescription(offerer.localDescription!)
    await answerer.setLocalDescription()
    await offerer.setRemoteDescription(answerer.localDescription!)
    return {offerer: offerer, answerer: answerer, received: await received}
}

describe('Media', (): void => {

    it('sends the packets of a track to the other member', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
        const stop: () => void = feed(video, 65500)
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
            const sending: Room = await alice.join('call')
            sending.on('peer', (peer: Peer): void => void peer.connection.addTrack(video, 'camera'))
            const receiving: Room = await bob.join('call')
            const event: PeerTrackEvent = await trackFrom(receiving, 'alice')
            assert.strictEqual(event.track.kind, 'video')
            assert.strictEqual(event.track.remote, true)
            assert.strictEqual(event.track.codec, 'video/VP8')
            assert.deepStrictEqual(event.streams.map((stream: {id: string}): string => stream.id), ['camera'])
            assert.strictEqual(event.transceiver.receiver.track, event.track)
            const received: RtpPacket[] = await packets(event.track, 100)
            //Sent as written, with the payload type and the synchronization source of the connection
            const negotiated: number = received[0].payloadType
            assert.notStrictEqual(negotiated, 96)
            for (const [index, packet] of received.entries()) {
                assert.strictEqual(packet.payloadType, negotiated)
                assert.notStrictEqual(packet.ssrc, 0x1234)
                if (index) {
                    assert.strictEqual(packet.sequenceNumber, (received[index - 1].sequenceNumber + 1) & 0xffff)
                    assert.strictEqual(packet.payload.readUInt32BE(0), received[index - 1].payload.readUInt32BE(0) + 1)
                }
            }
            //The sender's sequence numbers wrap around as the encoder's do
            assert.ok(received.some((packet: RtpPacket, index: number): boolean => index > 0 && packet.sequenceNumber < received[index - 1].sequenceNumber))
        } finally {
            stop()
            await clients.destroy()
            await server.stop()
        }
    })

    it('carries the key frame requests to the track sent', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
        const stop: () => void = feed(video)
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
            const sending: Room = await alice.join('call')
            sending.on('peer', (peer: Peer): void => void peer.connection.addTrack(video))
            const event: PeerTrackEvent = await trackFrom(await bob.join('call'), 'alice')
            await packets(event.track, 1)
            const requested: Promise<void> = next<void>((resolve: () => void): unknown => video.once('keyframerequest', resolve), 10000, 'the key frame request')
            event.track.requestKeyFrame()
            await requested
        } finally {
            stop()
            await clients.destroy()
            await server.stop()
        }
    })

    it('forwards a received track to another connection, and its key frame requests back', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        const video: MediaTrack = new MediaTrack('video', {codec: 'video/H264'})
        const stop: () => void = feed(video)
        try {
            const alice: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'alice'})
            const bob: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'bob'})
            const carol: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'carol'})
            //Alice sends to Bob only; Bob sends on to Carol what he receives
            const sending: Room = await alice.join('relay')
            sending.on('peer', (peer: Peer): void => {
                if (peer.id === 'bob') peer.connection.addTrack(video, 'camera')
            })
            const relaying: Room = await bob.join('relay')
            const fromAlice: Promise<PeerTrackEvent> = trackFrom(relaying, 'alice')
            const toCarol: Promise<Peer> = next<Peer>((resolve: (peer: Peer) => void): void => {
                relaying.on('peer', (peer: Peer): void => {
                    if (peer.id === 'carol') resolve(peer)
                })
            }, 20000, 'the peer of Carol')
            const receiving: Room = await carol.join('relay')
            const fromBob: Promise<PeerTrackEvent> = trackFrom(receiving, 'bob')
            const received: PeerTrackEvent = await fromAlice
            assert.strictEqual(received.track.codec, 'video/H264')
            ;(await toCarol).connection.addTrack(received.track, ...received.streams.map((stream: {id: string}): string => stream.id))
            const forwarded: PeerTrackEvent = await fromBob
            assert.strictEqual(forwarded.track.codec, 'video/H264')
            assert.deepStrictEqual(forwarded.streams.map((stream: {id: string}): string => stream.id), ['camera'])
            const [first, second] = await packets(forwarded.track, 2)
            assert.strictEqual(second.payload.readUInt32BE(0), first.payload.readUInt32BE(0) + 1)
            //Carol's request reaches the track Alice writes to
            const requested: Promise<void> = next<void>((resolve: () => void): unknown => video.once('keyframerequest', resolve), 10000, 'the key frame request')
            forwarded.track.requestKeyFrame()
            await requested
        } finally {
            stop()
            await clients.destroy()
            await server.stop()
        }
    })

    it('receives without sending, and offers the codecs chosen', {timeout: 60000}, async (): Promise<void> => {
        const server: TestServer = await startServer()
        const clients: Container = new Container()
        const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
        const stop: () => void = feed(audio)
        try {
            const recorder: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'recorder'})
            const speaker: SignalingClient = await clients.get(SignalingClient, {url: server.socketIO, id: 'speaker'})
            const recording: Room = await recorder.join('talk')
            recording.on('peer', (peer: Peer): void => void peer.connection.addTransceiver('audio', {direction: 'recvonly'}))
            const speaking: Room = await speaker.join('talk')
            speaking.on('peer', (peer: Peer): void => void peer.connection.addTrack(audio))
            const event: PeerTrackEvent = await trackFrom(recording, 'speaker')
            assert.strictEqual(event.track.codec, 'audio/opus')
            await packets(event.track, 10)
            await until((): boolean => event.transceiver.currentDirection !== null)
            assert.strictEqual(recording.peer('speaker')?.connection.getSenders().some((sender: RtpSender): boolean => sender.track !== null), false)
        } finally {
            stop()
            await clients.destroy()
            await server.stop()
        }
    })

    it('negotiates the header extensions of a media server when both connections have them', {timeout: 30000}, async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const descriptions = async (offering: boolean, answering: boolean): Promise<{offer: string, answer: string}> => {
                const offerer: PeerConnection = await container.get(PeerConnection, {headerExtensions: offering})
                const answerer: PeerConnection = await container.get(PeerConnection, {headerExtensions: answering})
                offerer.addTransceiver('audio')
                offerer.addTransceiver('video')
                await offerer.setLocalDescription()
                await answerer.setRemoteDescription(offerer.localDescription!)
                await answerer.setLocalDescription()
                const negotiated: {offer: string, answer: string} = {offer: offerer.localDescription!.sdp!, answer: answerer.localDescription!.sdp!}
                offerer.close()
                answerer.close()
                return negotiated
            }
            const both: {offer: string, answer: string} = await descriptions(true, true)
            for (const sdp of [both.offer, both.answer]) {
                //An id for each extension, the same in the audio and the video
                assert.deepStrictEqual(extensionsOf(sdp), [{
                    1: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
                    2: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
                    3: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
                    4: 'urn:ietf:params:rtp-hdrext:sdes:mid'
                }, {
                    2: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
                    3: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
                    4: 'urn:ietf:params:rtp-hdrext:sdes:mid'
                }])
                //The feedback of the transport-wide sequence numbers, for the codecs of the audio and of the video
                for (const media of sdp.split(/^m=/m).slice(1)) assert.match(media, /^a=rtcp-fb:\d+ transport-cc/m)
            }
            //Only the offer of the connection with them has them (the answer takes the feedback of the codecs of the offer)
            const offering: {offer: string, answer: string} = await descriptions(true, false)
            assert.strictEqual(extensionsOf(offering.offer)[1][3], 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01')
            assert.deepStrictEqual(extensionsOf(offering.answer), [{}, {}])
            for (const sdp of [...Object.values(await descriptions(false, true)), ...Object.values(await descriptions(false, false))]) {
                assert.deepStrictEqual(extensionsOf(sdp), [{}, {}])
                assert.doesNotMatch(sdp, /transport-cc/)
            }
        } finally {
            await container.destroy()
        }
    })

    it('estimates the bandwidth of what it sends from the transport-wide feedback of the other connection', {timeout: 30000}, async (): Promise<void> => {
        const container: Container = new Container()
        const video: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
        const stop: () => void = feed(video)
        try {
            const {offerer, answerer, received} = await directPair(container, video, {headerExtensions: true})
            await packets(received.track, 10)
            //The feedback of the receiving side gives the sending side the bit rate the packets arrive at
            await until((): boolean => (engineConnectionOf(offerer).dtlsTransports[0].senderBWE.availableBitrate) > 0, 10000, 'the estimate')
            assert.ok(engineConnectionOf(answerer).dtlsTransports[0].receiverTWCC.fbPktCount > 0)
        } finally {
            stop()
            await container.destroy()
        }
    })

    it('sends another track of another stream on a transceiver made inactive, without another media', {timeout: 30000}, async (): Promise<void> => {
        const container: Container = new Container()
        const first: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
        const second: MediaTrack = new MediaTrack('video', {codec: 'video/VP8'})
        const stops: (() => void)[] = [feed(first), feed(second, 50000)]
        try {
            const sending: PeerConnection = await container.get(PeerConnection)
            const receiving: PeerConnection = await container.get(PeerConnection)
            sending.on('icecandidate', (candidate: SignalingCandidate | null): void => void receiving.addIceCandidate(candidate))
            receiving.on('icecandidate', (candidate: SignalingCandidate | null): void => void sending.addIceCandidate(candidate))
            //Each change is negotiated by itself, as the negotiationneeded event asks
            let negotiations: Promise<void> = Promise.resolve()
            sending.on('negotiationneeded', (): void => {
                negotiations = negotiations.then(async (): Promise<void> => {
                    await sending.setLocalDescription()
                    await receiving.setRemoteDescription(sending.localDescription!)
                    await receiving.setLocalDescription()
                    await sending.setRemoteDescription(receiving.localDescription!)
                })
            })
            const events: PeerTrackEvent[] = []
            receiving.addEventListener('track', (event: PeerTrackEvent): unknown => events.push(event))
            const transceiver: RtpTransceiver = sending.addTransceiver(first, {direction: 'sendonly', streams: ['first']})
            await until((): boolean => events.length === 1, 10000, 'the first track')
            assert.deepStrictEqual(events[0].streams.map((stream: {id: string}): string => stream.id), ['first'])
            assert.ok((await packets(events[0].track, 5)).every((packet: RtpPacket): boolean => packet.payload.readUInt32BE(0) < 50000))
            //Made inactive: the other side stops receiving
            transceiver.direction = 'inactive'
            await until((): boolean => events[0].transceiver.currentDirection === 'inactive', 10000, 'the inactive transceiver')
            //Another track, of another stream: received again on the same transceiver
            await transceiver.sender.replaceTrack(second)
            transceiver.sender.setStreams('second')
            transceiver.direction = 'sendonly'
            await until((): boolean => events.length === 2, 10000, 'the second track')
            assert.deepStrictEqual(events[1].streams.map((stream: {id: string}): string => stream.id), ['second'])
            assert.strictEqual(events[1].transceiver, events[0].transceiver)
            assert.ok((await packets(events[1].track, 5)).every((packet: RtpPacket): boolean => packet.payload.readUInt32BE(0) >= 50000))
            assert.strictEqual(receiving.getTransceivers().length, 1)
            assert.strictEqual((sending.localDescription!.sdp!.match(/^m=/gm) ?? []).length, 1)
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await container.destroy()
        }
    })

    it('checks the codec of a track', (): void => {
        assert.throws((): MediaTrack => new MediaTrack('video', {codec: 'audio/opus'}), /is not one of video/)
        assert.throws((): MediaTrack => new MediaTrack('video', {codec: 'video/AV2'}), /is not supported/)
    })
})
