import {randomBytes} from 'node:crypto'

import {uint8Add} from '../../imports/common.js'
import {
    PacketChunk,
    PacketStatus,
    RecvDelta,
    RtcpTransportLayerFeedback,
    RunLengthChunk,
    StatusVectorChunk,
    TransportWideCC,
    debug
} from '../../imports/rtp.js'
import type {RTCDtlsTransport} from '../../transport/dtls.js'
import {microTime} from '../../utils.js'

const log = debug('webrtc/peer/media/receiver/receiverTwcc')

//How often the feedback is sent, in milliseconds (as libwebrtc does by default)
const FEEDBACK_INTERVAL = 100
//The most packets one feedback reports, for it to fit a datagram
const MAX_PACKETS_PER_FEEDBACK = 500
//The most arrivals kept until reported
const MAX_ARRIVALS = 1 << 15

/**
 * The statuses of the packets of a feedback in chunks: a run of the same status in a run length chunk, the others in
 * status vectors (of one bit while no delta is large)
 * @param statuses
 */
function packetChunksOf(statuses: PacketStatus[]): (RunLengthChunk | StatusVectorChunk)[] {
    const chunks: (RunLengthChunk | StatusVectorChunk)[] = []
    let index = 0
    while (index < statuses.length) {
        let run = 1
        while (index + run < statuses.length && statuses[index + run] === statuses[index] && run < 8191) run++
        if (run >= 7) {
            chunks.push(new RunLengthChunk({packetStatus: statuses[index], runLength: run}))
            index += run
            continue
        }
        const oneBit = statuses.slice(index, index + 14)
        const vector = oneBit.includes(PacketStatus.TypeTCCPacketReceivedLargeDelta)
            ? statuses.slice(index, index + 7)
            : oneBit
        const length = vector === oneBit ? 14 : 7
        chunks.push(new StatusVectorChunk({
            type: PacketChunk.TypeTCCStatusVectorChunk,
            symbolSize: length === 14 ? 0 : 1,
            //Filled up with packets not received, past the ones reported
            symbolList: [...vector, ...Array(length - vector.length).fill(PacketStatus.TypeTCCPacketNotReceived)]
        }))
        index += length
    }
    return chunks
}

/**
 * The transport-wide congestion control feedback of a transport: the arrival times of the packets it receives with a
 * transport-wide sequence number (the ones of all its streams), reported to the sender every FEEDBACK_INTERVAL. The
 * packets missing are reported lost; the ones arriving after their report are left out.
 */
export class ReceiverTWCC {
    /**The arrival times not reported yet, in microseconds, by sequence number (unwrapped)*/
    readonly arrivals = new Map<number, number>()
    /** uint8 */
    fbPktCount = 0
    readonly rtcpSsrc = randomBytes(4).readUInt32BE()
    private highestSequenceNumber?: number
    /**The first sequence number not reported yet (unwrapped)*/
    private nextSequenceNumber?: number
    private mediaSourceSsrc = 0
    private timer?: NodeJS.Timeout

    constructor(private dtlsTransport: RTCDtlsTransport) {}

    /**
     * A packet arrived
     * @param transportSequenceNumber
     * @param mediaSourceSsrc The synchronization source of the packet
     * @param arrivalTime In microseconds
     */
    handleTWCC(
        transportSequenceNumber: number,
        mediaSourceSsrc: number,
        arrivalTime: number = Number(microTime())
    ) {
        const sequenceNumber = this.unwrap(transportSequenceNumber)
        if (this.nextSequenceNumber !== undefined && sequenceNumber < this.nextSequenceNumber) return
        if (!this.arrivals.has(sequenceNumber)) this.arrivals.set(sequenceNumber, arrivalTime)
        if (this.arrivals.size > MAX_ARRIVALS) {
            let oldest = sequenceNumber
            for (const each of this.arrivals.keys()) oldest = Math.min(oldest, each)
            this.arrivals.delete(oldest)
            this.nextSequenceNumber = oldest + 1
        }
        this.mediaSourceSsrc = mediaSourceSsrc
        if (!this.timer) {
            this.timer = setInterval(() => this.sendTWCC(), FEEDBACK_INTERVAL)
            this.timer.unref()
        }
    }

    /**
     * Report no more
     */
    stop() {
        clearInterval(this.timer)
        this.timer = undefined
        this.arrivals.clear()
    }

    /**
     * Report the packets since the last report, up to the last one received
     */
    sendTWCC() {
        if (this.arrivals.size === 0) return
        let begin = this.nextSequenceNumber ?? Infinity
        if (begin === Infinity) {
            for (const sequenceNumber of this.arrivals.keys()) begin = Math.min(begin, sequenceNumber)
        }
        const end = this.highestSequenceNumber!
        while (begin <= end) {
            const {feedback, next} = this.buildFeedback(begin, end)
            this.dtlsTransport.sendRtcp([new RtcpTransportLayerFeedback({feedback})]).catch((error) => log(error))
            begin = next
        }
        this.arrivals.clear()
        this.nextSequenceNumber = end + 1
    }

    /**
     * The sequence number on more than 16 bits, the closest to the highest one received
     * @param sequenceNumber
     */
    private unwrap(sequenceNumber: number) {
        if (this.highestSequenceNumber === undefined) {
            this.highestSequenceNumber = sequenceNumber
            return sequenceNumber
        }
        let delta = (sequenceNumber - this.highestSequenceNumber) & 0xffff
        if (delta >= 0x8000) delta -= 0x10000
        const unwrapped = this.highestSequenceNumber + delta
        if (unwrapped > this.highestSequenceNumber) this.highestSequenceNumber = unwrapped
        return unwrapped
    }

    /**
     * The feedback of the packets from begin, up to end: it stops before a packet received too long after the one
     * before (its delta not fitting 16 bits), or after MAX_PACKETS_PER_FEEDBACK
     * @param begin
     * @param end
     */
    private buildFeedback(begin: number, end: number) {
        //The reference time is the one of the first packet received, in multiples of 64 ms
        let first = begin
        while (!this.arrivals.has(first)) first++
        const referenceTime = Math.floor(this.arrivals.get(first)! / 64000)
        let time = referenceTime * 64000

        const statuses: PacketStatus[] = []
        const recvDeltas: RecvDelta[] = []
        let sequenceNumber = begin
        for (; sequenceNumber <= end && statuses.length < MAX_PACKETS_PER_FEEDBACK; sequenceNumber++) {
            const arrival = this.arrivals.get(sequenceNumber)
            if (arrival === undefined) {
                statuses.push(PacketStatus.TypeTCCPacketNotReceived)
                continue
            }
            //In 250 µs
            const delta = Math.round((arrival - time) / 250)
            if (delta < -32768 || delta > 32767) break
            const type = delta >= 0 && delta <= 255
                ? PacketStatus.TypeTCCPacketReceivedSmallDelta
                : PacketStatus.TypeTCCPacketReceivedLargeDelta
            statuses.push(type)
            recvDeltas.push(new RecvDelta({type, delta: delta * 250}))
            time += delta * 250
        }

        const feedback = new TransportWideCC({
            senderSsrc: this.rtcpSsrc,
            mediaSourceSsrc: this.mediaSourceSsrc,
            baseSequenceNumber: begin & 0xffff,
            packetStatusCount: statuses.length,
            referenceTime: referenceTime & 0xffffff,
            fbPktCount: this.fbPktCount,
            packetChunks: packetChunksOf(statuses),
            recvDeltas
        })
        this.fbPktCount = uint8Add(this.fbPktCount, 1)
        return {feedback, next: sequenceNumber}
    }
}
