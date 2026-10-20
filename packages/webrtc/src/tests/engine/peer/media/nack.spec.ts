import {describe, test, expect} from '../../support/vitest.js'

import {type RtcpPacket, RtpHeader, RtpPacket} from '../../../../lib/rtp/index.js'
import {NackHandler} from '../../../../lib/peer/media/receiver/nack.js'

describe('media/nack', () => {
    test('16bit rotate', () => {
        const nack = new NackHandler(new MockRTCRtpReceiver() as any)
        let packet = new RtpPacket(
            new RtpHeader({sequenceNumber: 65535, ssrc: 1}),
            Buffer.from('')
        )
        nack.addPacket(packet)

        packet = new RtpPacket(
            new RtpHeader({sequenceNumber: 3, ssrc: 1}),
            Buffer.from('')
        )
        nack.addPacket(packet)

        try {
            expect(nack.lostSeqNumbers).toEqual([0, 1, 2])
        } finally {
            nack.close()
        }
    })
})

class MockRTCRtpReceiver {
    rtcpSsrc = 0
    dtlsTransport = {
        sendRtcp: (packets: RtcpPacket[]) => {
            const _payload = Buffer.concat(
                packets.map((packet) => packet.serialize())
            )
        }
    }
    sendRtcpPLI = () => {}
}
