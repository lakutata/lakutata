import {fixture} from '../../support/fixture.js'
import {opensslTests} from '../../support/requirements.js'
import {describe, test} from '../../support/vitest.js'
import {spawn} from 'node:child_process'
import {setTimeout} from 'node:timers/promises'

import {UdpTransport} from '../../../../lib/common/index.js'
import {HashAlgorithm, SignatureAlgorithm} from '../../../../lib/dtls/cipher/const.js'
import {DtlsClient} from '../../../../lib/dtls/client.js'
import {certPem, keyPem} from '../fixture.js'

describe('e2e/client', () => {
    test('openssl', {...opensslTests, timeout: 10_000}, async () => {
        const args = [
            's_server',
            '-cert',
            fixture('dtls/assets/cert.pem'),
            '-key',
            fixture('dtls/assets/key.pem'),
            '-dtls1_2',
            '-accept',
            '127.0.0.1:55555'
        ]

        const server = spawn('openssl', args)
        server.stdout.setEncoding('ascii')
        const received = new Promise<void>((done) => {
            server.stdout.on('data', (data: string) => {
                if (data.includes('my_dtls')) done()
            })
        })
        let client: DtlsClient | undefined
        try {
            await setTimeout(100)
            const transport = await UdpTransport.init('udp4')
            transport.rinfo = {address: '127.0.0.1', port: 55555}
            client = new DtlsClient({
                transport,
                cert: certPem,
                key: keyPem,
                signatureHash: {
                    hash: HashAlgorithm.sha256_4,
                    signature: SignatureAlgorithm.rsa_1
                }
            })
            const connected = client
            connected.onConnect.subscribe(() => {
                void connected.send(Buffer.from('my_dtls'))
            })
            void connected.connect()
            await received
        } finally {
            client?.close()
            server.kill()
        }
    })
})
