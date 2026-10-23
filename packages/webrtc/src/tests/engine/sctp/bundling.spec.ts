import {describe, test, expect, vi} from '../support/vitest.js'

import {SCTP} from '../../../lib/sctp/index.js'
import {DataChunk, parsePacket} from '../../../lib/sctp/chunk.js'
import type {Transport} from '../../../lib/sctp/transport.js'

describe('SCTP bundling', () => {
    test('sends the messages of one task in the same packet', async () => {
        const packets: Buffer[] = []
        const transport: Transport = {
            send: vi.fn(async (packet) => {
                packets.push(packet)
            }),
            close: vi.fn()
        }
        const sctp = SCTP.client(transport, 5000)
        sctp.setRemotePort(5001)
        try {
            //Five small messages sent one after the other, the congestion window open
            const sent: Promise<void>[] = []
            for (let index = 0; index < 5; index++) sent.push(sctp.send(1, 51, Buffer.alloc(100, index)))
            await Promise.all(sent)
            //One packet, of five DATA chunks in their order
            expect(packets).toHaveLength(1)
            const chunks = parsePacket(packets[0])[3] as DataChunk[]
            expect(chunks.map((chunk) => chunk.userData[0])).toEqual([0, 1, 2, 3, 4])
            //A message sent in a later task goes in its own packet
            await sctp.send(1, 51, Buffer.alloc(100, 5))
            expect(packets).toHaveLength(2)
        } finally {
            await sctp.stop()
        }
    })
})
