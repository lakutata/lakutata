import {spawnSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'

/**
 * The certificates of the tests of TLS: an authority, a server (localhost, 127.0.0.1) and a client it signs
 */
export type TestCertificates = {
    ca: Buffer
    serverCert: Buffer
    serverKey: Buffer
    clientCert: Buffer
    clientKey: Buffer
}

/**
 * Whether openssl is there
 */
export function openSSLAvailable(): boolean {
    return spawnSync('openssl', ['version'], {stdio: 'ignore'}).status === 0
}

/**
 * Create the certificates of the tests with openssl, in a directory
 * @param directory
 */
export function createTestCertificates(directory: string): TestCertificates {
    const run = (...args: string[]): void => {
        const result = spawnSync('openssl', args, {cwd: directory, encoding: 'utf8'})
        if (result.status !== 0) throw new Error(`openssl ${args.join(' ')} failed: ${result.stderr}`)
    }
    run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '1', '-subj', '/CN=lakutata test authority')
    for (const [name, usage, names] of [['server', 'serverAuth', 'DNS:localhost,IP:127.0.0.1'], ['client', 'clientAuth', 'DNS:client']]) {
        writeFileSync(path.join(directory, `${name}.ext`), `subjectAltName=${names}\nextendedKeyUsage=${usage}\nbasicConstraints=CA:FALSE\n`)
        run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=lakutata test ${name}`)
        run('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.crt`, '-days', '1', '-extfile', `${name}.ext`)
    }
    const read = (file: string): Buffer => readFileSync(path.join(directory, file))
    return {ca: read('ca.crt'), serverCert: read('server.crt'), serverKey: read('server.key'), clientCert: read('client.crt'), clientKey: read('client.key')}
}
