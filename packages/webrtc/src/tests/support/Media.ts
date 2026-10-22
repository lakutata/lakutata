import type {MediaTrack} from '../../peer/MediaTrack.js'
import type {RtpPacket} from '../../peer/RtpPacket.js'
import {next} from './Server.js'

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
