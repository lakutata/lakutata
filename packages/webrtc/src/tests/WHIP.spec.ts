import {describe, it, type TestContext} from 'node:test'
import assert from 'node:assert'
import {execFile, spawn} from 'node:child_process'
import type {Container} from '@lakutata/core'
import {MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import {PeerThreads} from '../peer/PeerThreads.js'
import type {RtpPacket} from '../peer/RtpPacket.js'
import type {WHIPSession} from '../whip/WHIP.js'
import {restartIce} from './support/Media.js'
import {next, NO_FASTIFY, startWHIP, until} from './support/Server.js'

/**
 * A publisher: a connection sending an audio and a video track, and its offer with all its candidates
 * @param container
 * @param threads Whether the connection is served in a worker thread
 */
async function publisher(container: Container, threads: boolean = false): Promise<{connection: PeerConnection, audio: MediaTrack, video: MediaTrack, offer: string}> {
    if (threads) await container.setNamed('publisherThreads', PeerThreads, {threads: 1})
    const connection: PeerConnection = await container.get(PeerConnection, {iceAdditionalHostAddresses: ['127.0.0.1'], ...threads ? {threads: 'publisherThreads'} : {}})
    const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
    const video: MediaTrack = new MediaTrack('video', {codec: 'video/H264'})
    connection.addTransceiver(audio, {direction: 'sendonly', streams: ['studio']})
    connection.addTransceiver(video, {direction: 'sendonly', streams: ['studio']})
    await connection.setLocalDescription()
    await until((): boolean => connection.iceGatheringState === 'complete', 10000, 'the candidates')
    return {connection: connection, audio: audio, video: video, offer: connection.localDescription!.sdp ?? ''}
}

/**
 * Write packets to a track until stopped
 * @param track
 */
function feed(track: MediaTrack): () => void {
    let sequenceNumber: number = 0
    const timer: NodeJS.Timeout = setInterval((): void => {
        const header: Buffer = Buffer.alloc(12)
        header[0] = 0x80
        header[1] = 96
        header.writeUInt16BE(sequenceNumber++ & 0xffff, 2)
        track.writeRtp(Buffer.concat([header, Buffer.from([1, 2, 3])]))
    }, 10)
    return (): void => clearInterval(timer)
}

/**
 * Whether ffmpeg has the WHIP muxer, libx264 and libopus
 */
function ffmpegWithWHIP(): Promise<boolean> {
    return new Promise((resolve: (available: boolean) => void): void => {
        execFile('ffmpeg', ['-hide_banner', '-muxers'], (error: Error | null, muxers: string): void => {
            if (error || !/\bwhip\b/.test(muxers)) return resolve(false)
            execFile('ffmpeg', ['-hide_banner', '-encoders'], (failure: Error | null, encoders: string): void => resolve(!failure && encoders.includes('libx264') && encoders.includes('libopus')))
        })
    })
}

/**
 * ffmpeg publishing a test pattern and a tone with WHIP for some seconds, then ending its session
 * @param url
 * @param token
 * @param seconds
 */
function ffmpegPublish(url: string, token: string, seconds: number): Promise<number | null> {
    return new Promise((resolve: (code: number | null) => void): void => {
        const ffmpeg = spawn('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-re',
            '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
            '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-tune', 'zerolatency', '-g', '30',
            //Stereo: the WHIP muxer of ffmpeg refuses mono Opus
            '-c:a', 'libopus', '-ac', '2', '-t', String(seconds),
            '-f', 'whip', '-authorization', token, url
        ], {stdio: 'ignore'})
        ffmpeg.once('exit', (code: number | null): void => resolve(code))
    })
}

describe('WHIP', (): void => {

    for (const threads of [false, true]) it(`answers the requests of WHIP, and publishes the tracks of an offer${threads ? ', the publisher served in a worker thread' : ''}`, {timeout: 60000}, async (): Promise<void> => {
        const {url, whip, container} = await startWHIP('express')
        const stops: (() => void)[] = []
        try {
            //CORS, GET
            const preflight: Response = await fetch(`${url}/whip/studio`, {method: 'OPTIONS'})
            assert.strictEqual(preflight.status, 204)
            assert.strictEqual(preflight.headers.get('accept-post'), 'application/sdp')
            assert.strictEqual(preflight.headers.get('access-control-allow-origin'), '*')
            assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Authorization/)
            assert.strictEqual((await fetch(`${url}/whip/studio`)).status, 204)
            //The offers refused
            assert.strictEqual((await fetch(`${url}/whip/studio`, {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: 'v=0'})).status, 415)
            const malformed: Response = await fetch(`${url}/whip/studio`, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'})
            assert.strictEqual(malformed.status, 400)
            assert.strictEqual((await malformed.json() as {errno: string}).errno, 'E_WHIP_OFFER')
            //A publication
            const published: Promise<WHIPSession> = next<WHIPSession>((resolve: (session: WHIPSession) => void): unknown => whip.once('publish', resolve), 20000, 'publish')
            const client = await publisher(container, threads)
            const response: Response = await fetch(`${url}/whip/studio`, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: client.offer})
            assert.strictEqual(response.status, 201)
            assert.strictEqual(response.headers.get('content-type'), 'application/sdp')
            assert.strictEqual(response.headers.get('access-control-expose-headers'), 'Location, Link, ETag')
            const location: string = response.headers.get('location') ?? ''
            assert.strictEqual(response.headers.get('etag'), `"${whip.entityTagOf(location.split('/').at(-1)!)}"`)
            assert.match(location, /^\/whip\/studio\/[0-9a-f-]{36}$/)
            const answer: string = await response.text()
            //All the candidates in the answer, which receives only
            assert.match(answer, /^a=candidate:/m)
            assert.doesNotMatch(answer, /^a=(sendrecv|sendonly)$/m)
            assert.match(answer, /^a=recvonly$/m)
            const session: WHIPSession = await published
            assert.strictEqual(session.stream, 'studio')
            assert.deepStrictEqual(session.tracks!.map((track: MediaTrack): string | undefined => track.codec).sort(), ['audio/opus', 'video/H264'])
            assert.strictEqual(location, `/whip/studio/${session.id}`)
            await client.connection.setRemoteDescription({type: 'answer', sdp: answer})
            stops.push(feed(client.audio), feed(client.video))
            await Promise.all(session.tracks!.map((track: MediaTrack): Promise<RtpPacket> => next<RtpPacket>((resolve: (packet: RtpPacket) => void): unknown => track.once('rtp', resolve), 20000, `the ${track.kind}`)))
            //The end of the candidates of the publisher, a fragment of no ICE
            const patch = (body: string): Promise<Response> => fetch(`${url}${location}`, {method: 'PATCH', headers: {'Content-Type': 'application/trickle-ice-sdpfrag'}, body: body})
            assert.strictEqual((await patch('a=end-of-candidates')).status, 204)
            assert.strictEqual((await patch('a=group:BUNDLE 0')).status, 400)
            //An ICE restart: the tracks go on
            const restarted = await restartIce(client.connection, `${url}${location}`)
            assert.strictEqual(restarted.response.status, 200)
            assert.strictEqual(restarted.response.headers.get('content-type'), 'application/trickle-ice-sdpfrag')
            await Promise.all(session.tracks!.map((track: MediaTrack): Promise<RtpPacket> => next<RtpPacket>((resolve: (packet: RtpPacket) => void): unknown => track.once('rtp', resolve), 20000, `the ${track.kind} after the restart`)))
            assert.strictEqual(client.connection.connectionState, 'connected')
            //The session of another stream, an unknown session
            assert.strictEqual((await fetch(`${url}/whip/other/${session.id}`, {method: 'DELETE'})).status, 404)
            assert.strictEqual((await fetch(`${url}/whip/studio/unknown`, {method: 'DELETE'})).status, 404)
            //The end of the session
            const unpublished: Promise<WHIPSession> = next<WHIPSession>((resolve: (session: WHIPSession) => void): unknown => whip.once('unpublish', resolve), 10000, 'unpublish')
            assert.strictEqual((await fetch(`${url}${location}`, {method: 'DELETE'})).status, 200)
            assert.strictEqual((await unpublished).id, session.id)
            assert.deepStrictEqual(whip.sessions, [])
            await until((): boolean => session.connection!.connectionState === 'closed', 5000, 'the closed connection')
        } finally {
            stops.forEach((stop: () => void): void => stop())
            await container.destroy()
        }
    })

    it('authorizes the publishers by their bearer token, and limits the sessions', {timeout: 60000, skip: NO_FASTIFY}, async (): Promise<void> => {
        const {url, whip, container} = await startWHIP('fastify', {
            authorize: ({stream, token}): boolean => stream === 'studio' && token === 'secret',
            maxSessions: 1
        })
        try {
            const client = await publisher(container)
            const post = (stream: string, token?: string): Promise<Response> => fetch(`${url}/whip/${stream}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/sdp', ...token ? {Authorization: `Bearer ${token}`} : {}},
                body: client.offer
            })
            const anonymous: Response = await post('studio')
            assert.strictEqual(anonymous.status, 401)
            assert.strictEqual(anonymous.headers.get('www-authenticate'), 'Bearer')
            assert.strictEqual((await post('studio', 'wrong')).status, 401)
            assert.strictEqual((await post('backstage', 'secret')).status, 401)
            const accepted: Response = await post('studio', 'secret')
            assert.strictEqual(accepted.status, 201)
            assert.strictEqual(whip.sessions.length, 1)
            //One session at most
            const refused: Response = await post('studio', 'secret')
            assert.strictEqual(refused.status, 503)
            assert.strictEqual((await refused.json() as {errno: string}).errno, 'E_WHIP_LIMIT')
        } finally {
            await container.destroy()
        }
        //The sessions end with the application
        assert.deepStrictEqual(whip.sessions, [])
    })

    for (const adapter of ['express', 'fastify'] as const) {
        it(`receives what ffmpeg publishes with WHIP (${adapter})`, {timeout: 60000, skip: adapter === 'fastify' && NO_FASTIFY}, async (t: TestContext): Promise<void> => {
            if (!await ffmpegWithWHIP()) return t.skip('ffmpeg with WHIP, libx264 and libopus is not available')
            const {url, whip, container} = await startWHIP(adapter, {authorize: ({token}): boolean => token === 'obs-token'})
            try {
                const published: Promise<WHIPSession> = next<WHIPSession>((resolve: (session: WHIPSession) => void): unknown => whip.once('publish', resolve), 20000, 'publish')
                const exited: Promise<number | null> = ffmpegPublish(`${url}/whip/studio`, 'obs-token', 4)
                const session: WHIPSession = await published
                const unpublished: Promise<WHIPSession> = next<WHIPSession>((resolve: (session: WHIPSession) => void): unknown => whip.once('unpublish', resolve), 30000, 'unpublish')
                assert.deepStrictEqual(session.tracks!.map((track: MediaTrack): string | undefined => track.codec).sort(), ['audio/opus', 'video/H264'])
                await Promise.all(session.tracks!.map((track: MediaTrack): Promise<RtpPacket> => next<RtpPacket>((resolve: (packet: RtpPacket) => void): unknown => track.once('rtp', resolve), 20000, `the ${track.kind} of ffmpeg`)))
                //ffmpeg deletes its session when it ends
                assert.strictEqual((await unpublished).id, session.id)
                assert.strictEqual(await exited, 0)
            } finally {
                await container.destroy()
            }
        })
    }
})
