import {describe, test, expect} from '../support/vitest.js'
import {UdpTransport} from '../../../lib/common/index.js'
import {DtlsServer} from '../../../lib/dtls/index.js'
import {CipherSuite} from '../../../lib/dtls/cipher/const.js'
import {ClientHello} from '../../../lib/dtls/handshake/message/client/hello.js'
import {DtlsRandom} from '../../../lib/dtls/handshake/random.js'

describe('server', () => {
    test('handleFragmentHandshake', async () => {
        const server = new DtlsServer({
            transport: await UdpTransport.init('udp4'),
            cert: '',
            key: ''
        })

        const hello = new ClientHello(
            {major: 255 - 1, minor: 255 - 2},
            new DtlsRandom(),
            Buffer.from([]),
            Buffer.from([]),
            [
                CipherSuite.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256_49199,
                CipherSuite.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256_49195
            ],
            [0], // don't compress
            []
        )

        try {
            const fragments = hello.toFragment().chunk(10)
            const last = fragments.pop()!
            const second = fragments.pop()!
            fragments.forEach((fragment) => server.handleFragmentHandshake([fragment]))
            expect(server.handleFragmentHandshake([last]).length).toBeGreaterThan(0)
            expect(server.handleFragmentHandshake([second]).length).toBe(0)
        } finally {
            server.close()
        }
    })
})
