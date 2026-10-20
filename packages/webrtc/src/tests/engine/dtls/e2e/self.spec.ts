import {expect, test} from '../../support/vitest.js'

import {UdpTransport} from '../../../../lib/common/index.js'
import {DtlsClient, DtlsServer} from '../../../../lib/dtls/index.js'
import {HashAlgorithm, SignatureAlgorithm} from '../../../../lib/dtls/cipher/const.js'
import {certPem, keyPem} from '../fixture.js'

test(
    'e2e/self',
    async () => {
        const word = 'self'

        const serverTransport = await UdpTransport.init('udp4')
        const server = new DtlsServer({
            transport: serverTransport,
            cert: certPem,
            key: keyPem,
            signatureHash: {
                hash: HashAlgorithm.sha256_4,
                signature: SignatureAlgorithm.rsa_1
            }
        })
        const transport = await UdpTransport.init('udp4')
        transport.rinfo = {address: '127.0.0.1', port: serverTransport.port}
        const client = new DtlsClient({
            transport,
            cert: certPem,
            key: keyPem,
            signatureHash: {
                hash: HashAlgorithm.sha256_4,
                signature: SignatureAlgorithm.rsa_1
            }
        })
        try {
            await new Promise<void>((done) => {
                server.onData.subscribe((data) => {
                    expect(data.toString()).toBe(word)
                    void server.send(Buffer.from(word + '_server'))
                })
                client.onConnect.subscribe(() => {
                    void client.send(Buffer.from(word))
                })
                client.onData.subscribe((data) => {
                    expect(data.toString()).toBe(word + '_server')
                    done()
                })
                void client.connect()
            })
        } finally {
            client.close()
            server.close()
        }
    },
    10_000
)
