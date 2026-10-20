import {expect, test} from '../../../support/vitest.js'
import {X509Certificate} from 'node:crypto'

import {UdpTransport, randomPort} from '../../../../../lib/common/index.js'
import {DtlsClient, DtlsServer} from '../../../../../lib/dtls/index.js'
import {HashAlgorithm, SignatureAlgorithm} from '../../../../../lib/dtls/cipher/const.js'
import {certPem, keyPem} from '../../fixture.js'

test(
    'e2e/certificate_request/self',
    async () => {
        const word = 'self'
        const port = await randomPort()
        const remoteCertificate = new X509Certificate(certPem).raw

        const server = new DtlsServer({
            cert: certPem,
            key: keyPem,
            signatureHash: {
                hash: HashAlgorithm.sha256_4,
                signature: SignatureAlgorithm.rsa_1
            },
            transport: await UdpTransport.init('udp4', {port}),
            certificateRequest: true
        })
        const transport = await UdpTransport.init('udp4')
        transport.rinfo = {
            address: '127.0.0.1',
            port
        }
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
                    expect(server.remoteCertificate).toEqual(remoteCertificate)
                    void server.send(Buffer.from(word + '_server'))
                })
                client.onConnect.subscribe(() => {
                    expect(client.remoteCertificate).toEqual(remoteCertificate)
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
