import {setTimeout} from 'node:timers/promises'
import {describe, test, expect} from '../support/vitest.js'
import {type Transport, UdpTransport} from '../../../lib/common/index.js'
import {DtlsClient, DtlsSocket} from '../../../lib/dtls/index.js'
import {SessionType} from '../../../lib/dtls/cipher/suites/abstract.js'
import {DtlsRandom} from '../../../lib/dtls/handshake/random.js'
import {certPem, keyPem} from './fixture.js'

describe('socket', () => {
    test('TestExportKeyingMaterial', async () => {
        const exportLabel = 'EXTRACTOR-dtls_srtp'

        const expectedServerKey = Buffer.from([
            0x61, 0x09, 0x9d, 0x7d, 0xcb, 0x08, 0x52, 0x2c, 0xe7, 0x7b
        ])
        const expectedClientKey = Buffer.from([
            0x87, 0xf0, 0x40, 0x02, 0xf6, 0x1c, 0xf1, 0xfe, 0x8c, 0x77
        ])
        const rand = Buffer.alloc(28)

        const socket = new DtlsSocket(
            {
                transport: await UdpTransport.init('udp4'),
                key: keyPem,
                cert: certPem
            },
            SessionType.SERVER
        )
        try {
            socket.cipher.localRandom = new DtlsRandom(500, rand)
            socket.cipher.remoteRandom = new DtlsRandom(1000, rand)
            socket.cipher.masterSecret = Buffer.from([])
            socket.cipher.cipherSuite = 0xc02b

            expect(socket.exportKeyingMaterial(exportLabel, 10)).toEqual(
                expectedServerKey
            )

            socket.sessionType = SessionType.CLIENT
            expect(socket.exportKeyingMaterial(exportLabel, 10)).toEqual(
                expectedClientKey
            )
        } finally {
            socket.close()
        }
    })

    test('a client closed during its handshake stops sending its flight again', async () => {
        const sent: Buffer[] = []
        const transport: Transport = {
            type: 'udp',
            address: {address: '127.0.0.1', family: 'IPv4', port: 9},
            closed: false,
            onData: () => undefined,
            send: async (data: Buffer) => void sent.push(data),
            close: async () => undefined
        }
        const client = new DtlsClient({transport: transport, cert: certPem, key: keyPem})
        client.connect().catch(() => undefined)
        await setTimeout(100)
        expect(sent.length).toBe(1)
        client.close()
        //Without it, sent again 0.5 s, then 1 s later
        await setTimeout(1700)
        expect(sent.length).toBe(1)
    })
})
