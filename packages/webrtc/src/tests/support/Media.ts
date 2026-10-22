import type {Container} from '@lakutata/core'
import {MediaTrack} from '../../peer/MediaTrack.js'
import {fragmentOf, iceOf} from '../../peer/Endpoints.js'
import {PeerConnection} from '../../peer/PeerConnection.js'
import type {RtpPacket} from '../../peer/RtpPacket.js'
import {next, until} from './Server.js'

/**
 * The bytes of an RTP packet as an encoder sends them (ffmpeg uses the payload type 96)
 * @param sequenceNumber
 * @param payload
 */
export function datagram(sequenceNumber: number, payload: Buffer): Buffer {
    const header: Buffer = Buffer.alloc(12)
    header[0] = 0x80
    header[1] = 96
    header.writeUInt16BE(sequenceNumber & 0xffff, 2)
    header.writeUInt32BE((sequenceNumber * 3000) >>> 0, 4)
    header.writeUInt32BE(0x1234, 8)
    return Buffer.concat([header, payload])
}

/**
 * Write packets to a track until stopped: a packet every 10 ms, its payload its number
 * @param track
 * @param first The first sequence number
 */
export function feed(track: MediaTrack, first: number = 0): () => void {
    let sequenceNumber: number = first
    const timer: NodeJS.Timeout = setInterval((): void => {
        const payload: Buffer = Buffer.alloc(4)
        payload.writeUInt32BE(sequenceNumber)
        track.writeRtp(datagram(sequenceNumber, payload))
        sequenceNumber++
    }, 10)
    return (): void => clearInterval(timer)
}

/**
 * The next packets of a track
 * @param track
 * @param count
 */
export function packets(track: MediaTrack, count: number): Promise<RtpPacket[]> {
    return next<RtpPacket[]>((resolve: (packets: RtpPacket[]) => void): void => {
        const received: RtpPacket[] = []
        const listener = (packet: RtpPacket): void => {
            received.push(packet)
            if (received.length < count) return
            track.off('rtp', listener)
            resolve(received)
        }
        track.on('rtp', listener)
    }, 20000, `${count} packets`)
}

/**
 * Whether the packets of a track come from the member whose numbers start at `first` (100000 numbers each)
 * @param track
 * @param first
 */
export async function from(track: MediaTrack, first: number): Promise<boolean> {
    return (await packets(track, 5)).every((packet: RtpPacket): boolean => {
        const number: number = packet.payload.readUInt32BE(0)
        return number >= first && number < first + 100000
    })
}

/**
 * A publisher of WHIP from Node.js: an audio and a video track whose packets carry numbers from `first`, their offer
 * POSTed with all its candidates
 * @param container
 * @param url The URL of the endpoint.
 * @param first
 * @param video The codec of the video.
 * @returns The connection, the response, its URL, and a function stopping the packets.
 */
export async function whipPublisher(container: Container, url: string, first: number, video: string = 'video/VP8'): Promise<{connection: PeerConnection, response: Response, location?: string, stop(): void}> {
    const connection: PeerConnection = await container.get(PeerConnection, {iceAdditionalHostAddresses: ['127.0.0.1']})
    const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
    const camera: MediaTrack = new MediaTrack('video', {codec: video})
    const stops: (() => void)[] = [feed(audio, first), feed(camera, first)]
    connection.addTransceiver(audio, {direction: 'sendonly', streams: ['broadcast']})
    connection.addTransceiver(camera, {direction: 'sendonly', streams: ['broadcast']})
    await connection.setLocalDescription()
    await until((): boolean => connection.iceGatheringState === 'complete', 10000, 'the candidates')
    const response: Response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: connection.localDescription!.sdp})
    if (response.status === 201) await connection.setRemoteDescription({type: 'answer', sdp: await response.text()})
    return {connection: connection, response: response, location: response.headers.get('Location') ?? undefined, stop: (): void => stops.forEach((stop: () => void): void => stop())}
}

/**
 * Restart ICE on the connection of a client of WHIP or WHEP: its new credentials and candidates PATCHed to its
 * session, the fragment of the answer applied
 * @param connection
 * @param url The URL of the session.
 * @returns The response, and the fragment of its answer.
 */
export async function restartIce(connection: PeerConnection, url: string): Promise<{response: Response, fragment?: string}> {
    connection.restartIce()
    await connection.setLocalDescription()
    await until((): boolean => connection.iceGatheringState === 'complete', 10000, 'the new candidates')
    const response: Response = await fetch(url, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*'},
        body: fragmentOf(connection.localDescription!.sdp!)
    })
    if (response.status !== 200) return {response: response}
    const fragment: string = await response.text()
    const ice = iceOf(fragment)
    const answer: string = connection.remoteDescription!.sdp!
        .replace(/^a=ice-ufrag:.*$/gm, `a=ice-ufrag:${ice.ufrag}`)
        .replace(/^a=ice-pwd:.*$/gm, `a=ice-pwd:${ice.pwd}`)
        .replace(/^a=(candidate:.*|end-of-candidates)\r?\n/gm, '')
    await connection.setRemoteDescription({type: 'answer', sdp: answer})
    for (const candidate of ice.candidates) await connection.addIceCandidate({candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null})
    return {response: response, fragment: fragment}
}
