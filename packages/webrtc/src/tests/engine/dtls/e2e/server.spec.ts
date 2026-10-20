import {opensslTests} from '../../support/requirements.js'
import {describe, test} from '../../support/vitest.js'
import {spawn} from 'node:child_process'
import {setTimeout} from 'node:timers/promises'

import {UdpTransport} from '../../../../lib/common/index.js'
import {HashAlgorithm, SignatureAlgorithm} from '../../../../lib/dtls/cipher/const.js'
import {CipherContext} from '../../../../lib/dtls/context/cipher.js'
import {DtlsServer} from '../../../../lib/dtls/server.js'
import {certPem, keyPem} from '../fixture.js'

//Connects openssl s_client to the server and waits for the data the server sends once connected
async function receiveWithOpenssl(transport: UdpTransport, server: DtlsServer): Promise<void> {
    server.onConnect.subscribe(() => {
        void server.send(Buffer.from('my_dtls_server'))
    })

    await setTimeout(100)
    const client = spawn('openssl', [
        's_client',
        '-dtls1_2',
        '-connect',
        `127.0.0.1:${transport.port}`
    ])
    client.stdout.setEncoding('ascii')
    try {
        await new Promise<void>((done) => {
            client.stdout.on('data', (data: string) => {
                if (data.includes('my_dtls_server')) done()
            })
        })
    } finally {
        client.kill()
        server.close()
    }
}

describe('e2e/server', () => {
    test('openssl', {...opensslTests, timeout: 10_000}, async () => {
        const transport = await UdpTransport.init('udp4')
        const server = new DtlsServer({
            cert: certPem,
            key: keyPem,
            signatureHash: {
                hash: HashAlgorithm.sha256_4,
                signature: SignatureAlgorithm.rsa_1
            },
            transport
        })
        await receiveWithOpenssl(transport, server)
    })

    test('openssl use self sign certificate', {...opensslTests, timeout: 10_000}, async () => {
        const transport = await UdpTransport.init('udp4')

        const server = new DtlsServer({
            transport
        })
        const {certPem, keyPem, signatureHash} =
            await CipherContext.createSelfSignedCertificateWithKey({
                hash: HashAlgorithm.sha256_4,
                signature: SignatureAlgorithm.rsa_1
            })
        server.cipher.parseX509(certPem, keyPem, signatureHash)

        await receiveWithOpenssl(transport, server)
    })
})
