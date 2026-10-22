import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import type {MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection, type PeerTrackEvent} from '../peer/PeerConnection.js'
import type {RtpPacket} from '../peer/RtpPacket.js'
import type {WHEPSession} from '../whep/WHEP.js'
import type {WHIPSession} from '../whip/WHIP.js'
import {iceOf} from '../peer/Endpoints.js'
import {from, packets, restartIce, whipPublisher} from './support/Media.js'
import {next, startServer, type TestServer, until} from './support/Server.js'

/**
 * A viewer of WHEP from Node.js: a connection receiving an audio and a video track, its offer POSTed with all its
 * candidates
 * @param container
 * @param url The URL of the endpoint.
 * @returns The connection, the response, its URL, and the tracks received by kind.
 */
async function whepViewer(container: Container, url: string): Promise<{connection: PeerConnection, response: Response, location?: string, tracks: Map<string, MediaTrack>}> {
    const connection: PeerConnection = await container.get(PeerConnection, {iceAdditionalHostAddresses: ['127.0.0.1']})
    const tracks: Map<string, MediaTrack> = new Map()
    connection.addEventListener('track', (event: PeerTrackEvent): unknown => tracks.set(event.track.kind, event.track))
    connection.addTransceiver('audio', {direction: 'recvonly'})
    connection.addTransceiver('video', {direction: 'recvonly'})
    await connection.setLocalDescription()
    await until((): boolean => connection.iceGatheringState === 'complete', 10000, 'the candidates')
    const response: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: connection.localDescription!.sdp})
    if (response.status === 201) await connection.setRemoteDescription({type: 'answer', sdp: await response.text()})
    return {connection: connection, response: response, location: response.headers.get('Location') ?? undefined, tracks: tracks}
}

/**
 * The payload type of a codec in a description
 * @param sdp
 * @param codec
 */
function payloadTypeOf(sdp: string, codec: string): number {
    return Number(new RegExp(`^a=rtpmap:(\\d+) ${codec}/90000`, 'mi').exec(sdp)![1])
}

describe('WHEP', (): void => {

    it('plays the stream published with WHIP into its room, then the next one, of another codec', {timeout: 90000}, async (): Promise<void> => {
        //The viewers are not members: the stream published is the only one
        const server: TestServer = await startServer({sfu: {maxMembers: 1}, whip: {}, whep: {}})
        const container: Container = new Container()
        const stops: (() => void)[] = []
        const played: WHEPSession[] = []
        const stopped: WHEPSession[] = []
        server.whep!.on('play', (session: WHEPSession): number => played.push(session))
        server.whep!.on('stop', (session: WHEPSession): number => stopped.push(session))
        try {
            const first = await whipPublisher(container, `${server.http}/whip/show`, 0)
            stops.push(first.stop)
            await until((): boolean => server.sfu!.rooms().show?.tracks.length === 2, 10000, 'the tracks of the first stream')
            const viewer = await whepViewer(container, `${server.http}/whep/show`)
            assert.strictEqual(viewer.response.status, 201)
            assert.match(viewer.location!, /^\/whep\/show\/[0-9a-f-]+$/)
            await until((): boolean => viewer.tracks.size === 2, 10000, 'the tracks of the viewer')
            const video: MediaTrack = viewer.tracks.get('video')!
            assert.ok(await from(video, 0), 'the video of the first stream')
            assert.ok(await from(viewer.tracks.get('audio')!, 0), 'the audio of the first stream')
            const whip: WHIPSession = server.whip!.sessions[0]
            assert.deepStrictEqual([played.length, played[0].room, played[0].source], [1, 'show', whip.peerId])
            assert.match(played[0].viewerId, /^whep:/)
            assert.strictEqual(server.sfu!.rooms().show.viewers, 1)
            //The first stream ends, the next one is of H.264: the viewer goes on receiving, on the same connection
            assert.strictEqual((await fetch(`${server.http}${first.location}`, {method: 'DELETE'})).status, 200)
            const next = await whipPublisher(container, `${server.http}/whip/show`, 200000, 'video/H264')
            stops.push(next.stop)
            await until((): boolean => played[0].source === server.whip!.sessions[0]?.peerId, 10000, 'the next source')
            const h264: number = payloadTypeOf(viewer.connection.localDescription!.sdp!, 'H264')
            const received: RtpPacket[] = (await packets(video, 50)).filter((packet: RtpPacket): boolean => packet.payload.readUInt32BE(0) >= 200000)
            assert.ok(received.length > 0, 'the video of the next stream')
            assert.ok(received.every((packet: RtpPacket): boolean => packet.payloadType === h264))
            //Its viewer stops it
            assert.strictEqual((await fetch(`${server.http}${viewer.location}`, {method: 'DELETE'})).status, 200)
            assert.deepStrictEqual(stopped.map((session: WHEPSession): string => session.id), [played[0].id])
            assert.strictEqual(server.sfu!.rooms().show.viewers, 0)
            assert.strictEqual((await fetch(`${server.http}${viewer.location}`, {method: 'DELETE'})).status, 404)
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await container.destroy()
            await server.stop()
        }
    })

    it('takes the candidates of a viewer and restarts ICE with PATCH, the media going on', {timeout: 90000}, async (): Promise<void> => {
        const server: TestServer = await startServer({sfu: {}, whip: {}, whep: {}})
        const container: Container = new Container()
        const stops: (() => void)[] = []
        try {
            const publisher = await whipPublisher(container, `${server.http}/whip/live`, 400000)
            stops.push(publisher.stop)
            const viewer = await whepViewer(container, `${server.http}/whep/live`)
            const tag: string = viewer.response.headers.get('ETag')!
            assert.match(tag, /^"[0-9a-f]+"$/)
            await until((): boolean => viewer.tracks.get('video') !== undefined, 10000, 'the video')
            assert.ok(await from(viewer.tracks.get('video')!, 400000))
            const url: string = `${server.http}${viewer.location}`
            const ufrag: string = iceOf(viewer.connection.localDescription!.sdp!).ufrag!
            const trickle = (headers: Record<string, string>): Promise<Response> => fetch(url, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/trickle-ice-sdpfrag', ...headers},
                body: `a=ice-ufrag:${ufrag}\r\na=ice-pwd:${iceOf(viewer.connection.localDescription!.sdp!).pwd}\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=mid:0\r\na=candidate:1 1 udp 2130706431 127.0.0.1 9 typ host\r\n`
            })
            //Trickle ICE: a candidate of the same credentials
            assert.strictEqual((await trickle({'If-Match': tag})).status, 204)
            assert.strictEqual((await trickle({})).status, 204)
            //The ICE session of another tag, not a fragment of SDP, another session
            assert.strictEqual((await trickle({'If-Match': '"other"'})).status, 412)
            assert.strictEqual((await fetch(url, {method: 'PATCH', headers: {'Content-Type': 'application/sdp'}, body: 'v=0'})).status, 415)
            assert.strictEqual((await fetch(`${server.http}/whep/live/0b7d`, {method: 'PATCH', headers: {'Content-Type': 'application/trickle-ice-sdpfrag'}, body: 'a=ice-ufrag:x'})).status, 404)
            //An ICE restart: new credentials on both sides, a new tag, the video going on
            const before: string = iceOf(viewer.connection.remoteDescription!.sdp!).ufrag!
            const restarted = await restartIce(viewer.connection, url)
            assert.strictEqual(restarted.response.status, 200)
            assert.notStrictEqual(restarted.response.headers.get('ETag'), tag)
            assert.notStrictEqual(iceOf(restarted.fragment!).ufrag, before)
            assert.ok(iceOf(restarted.fragment!).candidates.length > 0)
            const video: MediaTrack = viewer.tracks.get('video')!
            await packets(video, 5)
            assert.ok(await from(video, 400000), 'the video after the restart')
            assert.strictEqual(viewer.connection.connectionState, 'connected')
            //The fragment of the ICE session before the restart, sent again: not applied
            const stale: string = `a=ice-ufrag:${ufrag}\r\na=ice-pwd:${iceOf(viewer.connection.localDescription!.sdp!).pwd}\r\n`
            assert.strictEqual((await fetch(url, {method: 'PATCH', headers: {'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': tag}, body: stale})).status, 412)
            assert.strictEqual((await fetch(url, {method: 'PATCH', headers: {'Content-Type': 'application/trickle-ice-sdpfrag'}, body: stale})).status, 412)
            await packets(video, 5)
            assert.strictEqual(viewer.connection.connectionState, 'connected')
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await container.destroy()
            await server.stop()
        }
    })

    it('plays a stream published after it starts, up to its sessions, in the rooms of the server', {timeout: 90000}, async (): Promise<void> => {
        const server: TestServer = await startServer({sfu: {serves: (room: string): boolean => room !== 'lobby'}, whip: {}, whep: {maxSessions: 1}})
        const container: Container = new Container()
        const stops: (() => void)[] = []
        try {
            //Nothing published yet
            const viewer = await whepViewer(container, `${server.http}/whep/later`)
            assert.strictEqual(viewer.response.status, 201)
            assert.strictEqual(server.whep!.sessions[0].source, undefined)
            //Published with H.264: one of the codecs the viewer negotiated
            const publisher = await whipPublisher(container, `${server.http}/whip/later`, 300000, 'video/H264')
            stops.push(publisher.stop)
            await until((): boolean => viewer.tracks.get('video') !== undefined, 10000, 'the video track')
            const video: MediaTrack = viewer.tracks.get('video')!
            await until((): boolean => server.whep!.sessions[0].source !== undefined, 10000, 'the source')
            const received: RtpPacket[] = await next<RtpPacket[]>((resolve: (received: RtpPacket[]) => void): void => {
                const kept: RtpPacket[] = []
                video.on('rtp', (packet: RtpPacket): void => {
                    if (packet.payload.readUInt32BE(0) >= 300000) kept.push(packet)
                    if (kept.length === 5) resolve(kept)
                })
            }, 20000, 'the video of the stream')
            assert.ok(received.every((packet: RtpPacket): boolean => packet.payloadType === payloadTypeOf(viewer.connection.localDescription!.sdp!, 'H264')))
            //One session at most
            const second = await whepViewer(container, `${server.http}/whep/later`)
            assert.strictEqual(second.response.status, 503)
            //Not a room of the server
            await fetch(`${server.http}${viewer.location}`, {method: 'DELETE'})
            const refused = await whepViewer(container, `${server.http}/whep/lobby`)
            assert.strictEqual(refused.response.status, 400)
            //Not an offer of SDP
            assert.strictEqual((await fetch(`${server.http}/whep/later`, {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: 'v=0'})).status, 415)
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await container.destroy()
            await server.stop()
        }
    })
})
