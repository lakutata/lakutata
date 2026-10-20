import {createPrivateKey, generateKeyPairSync, type KeyObject, randomBytes, sign} from 'node:crypto'

/**
 * The algorithm of the key of a self-signed certificate: ECDSA on P-256, or RSA (2048 bits)
 */
export type CertificateKeyType = 'ecdsa' | 'rsa'

/**
 * A certificate and its private key, both in PEM
 */
export interface CertificatePem {
    certPem: string
    keyPem: string
}

//DER: a tag, the length (short form under 128 bytes, long form above), then the content
function der(tag: number, content: Buffer): Buffer {
    const length: number = content.length
    if (length < 0x80) return Buffer.concat([Buffer.from([tag, length]), content])
    const bytes: number[] = []
    for (let rest: number = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff)
    return Buffer.concat([Buffer.from([tag, 0x80 | bytes.length, ...bytes]), content])
}

const sequence = (...items: Buffer[]): Buffer => der(0x30, Buffer.concat(items))
const set = (...items: Buffer[]): Buffer => der(0x31, Buffer.concat(items))
const nullValue: Buffer = Buffer.from([0x05, 0x00])
const utf8String = (text: string): Buffer => der(0x0c, Buffer.from(text, 'utf8'))
const bitString = (content: Buffer): Buffer => der(0x03, Buffer.concat([Buffer.from([0]), content]))
const explicit = (tag: number, content: Buffer): Buffer => der(0xa0 | tag, content)

//A positive INTEGER: a leading zero when the first bit is set, so it is not read as negative
function integer(value: Buffer): Buffer {
    let start: number = 0
    while (start < value.length - 1 && value[start] === 0) start++
    const trimmed: Buffer = value.subarray(start)
    return der(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed)
}

//An OBJECT IDENTIFIER from its dotted form: the first two arcs in one byte, the others in base 128
function oid(dotted: string): Buffer {
    const arcs: number[] = dotted.split('.').map(Number)
    const bytes: number[] = [arcs[0] * 40 + arcs[1]]
    for (const arc of arcs.slice(2)) {
        const encoded: number[] = [arc & 0x7f]
        for (let rest: number = Math.floor(arc / 128); rest > 0; rest = Math.floor(rest / 128)) encoded.unshift(0x80 | (rest & 0x7f))
        bytes.push(...encoded)
    }
    return der(0x06, Buffer.from(bytes))
}

//UTCTime up to 2049, GeneralizedTime from 2050 (RFC 5280 section 4.1.2.5)
function time(date: Date): Buffer {
    const iso: string = date.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    return date.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(`${iso.slice(2)}Z`)) : der(0x18, Buffer.from(`${iso}Z`))
}

const commonName = (name: string): Buffer => sequence(set(sequence(oid('2.5.4.3'), utf8String(name))))

/**
 * Creates a self-signed X.509 certificate for DTLS: the peers of WebRTC check it against the fingerprint in the SDP,
 * not against a certificate authority, so it only has to be well formed
 * @param keyType The algorithm of the key; ECDSA on P-256 by default, as the browsers use
 * @param name The common name of the subject and the issuer
 * @param days How long the certificate is valid, from a day before now
 * @returns The certificate and its private key (PKCS #8), in PEM
 */
export function createDtlsCertificate(keyType: CertificateKeyType = 'ecdsa', name: string = 'WebRTC', days: number = 30): CertificatePem {
    const {privateKey, publicKey} = keyType === 'ecdsa'
        ? generateKeyPairSync('ec', {namedCurve: 'prime256v1'})
        : generateKeyPairSync('rsa', {modulusLength: 2048, publicExponent: 0x10001})
    //ecdsa-with-SHA256 has no parameters, sha256WithRSAEncryption a NULL one
    const algorithm: Buffer = keyType === 'ecdsa'
        ? sequence(oid('1.2.840.10045.4.3.2'))
        : sequence(oid('1.2.840.113549.1.1.11'), nullValue)
    const notBefore: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const notAfter: Date = new Date(notBefore.getTime() + (days + 1) * 24 * 60 * 60 * 1000)
    const serial: Buffer = randomBytes(8)
    serial[0] &= 0x7f
    const subject: Buffer = commonName(name)
    const toBeSigned: Buffer = sequence(
        explicit(0, integer(Buffer.from([2]))),
        integer(serial),
        algorithm,
        subject,
        sequence(time(notBefore), time(notAfter)),
        subject,
        publicKey.export({type: 'spki', format: 'der'})
    )
    const signature: Buffer = sign('sha256', toBeSigned, privateKey)
    const certificate: Buffer = sequence(toBeSigned, algorithm, bitString(signature))
    return {
        certPem: toPem(certificate, 'CERTIFICATE'),
        keyPem: privateKey.export({type: 'pkcs8', format: 'pem'}) as string
    }
}

/**
 * Wraps DER in PEM, 64 characters of base64 per line
 */
export function toPem(derBytes: Buffer, label: string): string {
    const lines: string[] = derBytes.toString('base64').match(/.{1,64}/g) ?? []
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/**
 * The DER of the first certificate of a PEM text
 */
export function certificateDer(pem: string): Buffer {
    const match: RegExpMatchArray | null = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)
    if (!match) throw new Error('no certificate in the PEM text')
    return Buffer.from(match[1].replace(/\s+/g, ''), 'base64')
}

/**
 * The private key of a PEM text (PKCS #8, PKCS #1 or SEC 1)
 */
export function privateKeyFromPem(pem: string): KeyObject {
    return createPrivateKey(pem)
}
