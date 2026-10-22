import {describe, test, expect, vi} from '../../support/vitest.js'
import {setTimeout} from 'node:timers/promises'

import {
    type PacketResult,
    type RtcpPacket,
    RtcpPacketConverter,
    RtcpTransportLayerFeedback,
    TransportWideCC
} from '../../../../lib/rtp/index.js'
import {createDtlsTransport} from '../fixture.js'

//An arrival time, in microseconds (12.345 ms past a multiple of 64 ms)
const T0 = 1_700_000_000_012_345

/**
 * The transport-wide feedback of a transport, and the feedback it sent (serialized and parsed back)
 */
function arrange() {
    const dtls = createDtlsTransport()
    const sendRtcp = vi.spyOn(dtls, 'sendRtcp').mockResolvedValue(undefined as never)
    const sent = (): TransportWideCC[] =>
        sendRtcp.mock.calls.flatMap(([packets]) =>
            RtcpPacketConverter.deSerialize(
                Buffer.concat((packets as RtcpPacket[]).map((packet) => packet.serialize()))
            ).map((packet) => (packet as RtcpTransportLayerFeedback).feedback as TransportWideCC)
        )
    return {dtls, twcc: dtls.receiverTWCC, sendRtcp, sent}
}

/**
 * The results of the feedback, without the deltas
 * @param feedback
 */
function resultsOf(feedback: TransportWideCC) {
    return feedback.packetResults.map((result: PacketResult) => ({
        sequenceNumber: result.sequenceNumber,
        received: result.received
    }))
}

describe('ReceiverTWCC', () => {
    test('reports the packets of all the streams, the missing ones lost, with their arrival times', () => {
        const {twcc, sent} = arrange()
        twcc.handleTWCC(1, 111, T0)
        twcc.handleTWCC(2, 222, T0 + 5000)
        twcc.handleTWCC(4, 111, T0 + 20000)
        twcc.sendTWCC()

        const [feedback] = sent()
        expect(sent()).toHaveLength(1)
        expect(feedback.baseSequenceNumber).toBe(1)
        expect(feedback.packetStatusCount).toBe(4)
        expect(feedback.mediaSourceSsrc).toBe(111)
        expect(resultsOf(feedback)).toEqual([
            {sequenceNumber: 1, received: true},
            {sequenceNumber: 2, received: true},
            {sequenceNumber: 3, received: false},
            {sequenceNumber: 4, received: true}
        ])
        const times = feedback.packetResults
            .filter((result) => result.received)
            .map((result) => result.receivedAtMs)
        //From the reference time (in multiples of 64 ms), in multiples of 250 µs
        expect(times[0] - feedback.referenceTime * 64).toBe(12.25)
        expect([times[1] - times[0], times[2] - times[0]]).toEqual([5, 20])
        twcc.stop()
    })

    test('starts the next feedback after the last packet reported, leaving out the late ones', () => {
        const {twcc, sent} = arrange()
        twcc.handleTWCC(10, 111, T0)
        twcc.handleTWCC(12, 111, T0 + 1000)
        twcc.sendTWCC()
        //11 arrives after the report of its loss
        twcc.handleTWCC(11, 111, T0 + 2000)
        twcc.handleTWCC(14, 111, T0 + 3000)
        twcc.sendTWCC()

        const feedback = sent()
        expect(feedback.map((each) => each.fbPktCount)).toEqual([0, 1])
        expect(resultsOf(feedback[1])).toEqual([
            {sequenceNumber: 13, received: false},
            {sequenceNumber: 14, received: true}
        ])
        //Nothing new: nothing sent
        twcc.sendTWCC()
        expect(sent()).toHaveLength(2)
        twcc.stop()
    })

    test('goes on past the largest sequence number', () => {
        const {twcc, sent} = arrange()
        for (const [index, sequenceNumber] of [65534, 65535, 0, 1].entries()) {
            twcc.handleTWCC(sequenceNumber, 111, T0 + index * 1000)
        }
        twcc.sendTWCC()

        const [feedback] = sent()
        expect(feedback.baseSequenceNumber).toBe(65534)
        expect(resultsOf(feedback)).toEqual([
            {sequenceNumber: 65534, received: true},
            {sequenceNumber: 65535, received: true},
            {sequenceNumber: 0, received: true},
            {sequenceNumber: 1, received: true}
        ])
        twcc.stop()
    })

    test('reports in another feedback a packet arriving too long after the one before, and past 500 packets', () => {
        const {twcc, sent} = arrange()
        twcc.handleTWCC(1, 111, T0)
        //9 s later: more than a delta of 16 bits (8.19 s)
        twcc.handleTWCC(2, 111, T0 + 9_000_000)
        twcc.sendTWCC()
        expect(sent().map(resultsOf)).toEqual([
            [{sequenceNumber: 1, received: true}],
            [{sequenceNumber: 2, received: true}]
        ])

        for (let sequenceNumber = 3; sequenceNumber <= 702; sequenceNumber++) {
            twcc.handleTWCC(sequenceNumber, 111, T0 + 9_000_000 + sequenceNumber * 100)
        }
        twcc.sendTWCC()
        const [, , first, second] = sent()
        expect([first.baseSequenceNumber, first.packetStatusCount]).toEqual([3, 500])
        expect([second.baseSequenceNumber, second.packetStatusCount]).toEqual([503, 200])
        expect(second.packetResults.every((result) => result.received)).toBe(true)
        twcc.stop()
    })

    test('sends the feedback every 100 ms once packets arrive, until stopped', async () => {
        const {twcc, sendRtcp} = arrange()
        await setTimeout(150)
        expect(sendRtcp).not.toHaveBeenCalled()
        twcc.handleTWCC(1, 111)
        await setTimeout(150)
        expect(sendRtcp).toHaveBeenCalledTimes(1)
        twcc.handleTWCC(2, 111)
        twcc.stop()
        await setTimeout(150)
        expect(sendRtcp).toHaveBeenCalledTimes(1)
    })
})
