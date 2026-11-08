import {X509Certificate} from 'node:crypto'
import type * as tls from 'node:tls'

//Client authentication, and any purpose, as extended key usages
const CLIENT_AUTH: string = '1.3.6.1.5.5.7.3.2'
const ANY_PURPOSE: string = '2.5.29.37.0'

/**
 * The certificates of the CA option of a TLS context (PEM text or bytes, one or several)
 * @param ca The CA option.
 */
export function certificatesOf(ca: tls.SecureContextOptions['ca']): X509Certificate[] {
    const items: (string | Buffer)[] = ca === undefined ? [] : Array.isArray(ca) ? ca : [ca as string | Buffer]
    const certificates: X509Certificate[] = []
    for (const item of items) {
        const text: string = typeof item === 'string' ? item : item.toString('latin1')
        const blocks: string[] = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
        if (blocks.length) for (const block of blocks) certificates.push(new X509Certificate(block))
        else if (Buffer.isBuffer(item)) certificates.push(new X509Certificate(item))
    }
    return certificates
}

/**
 * Whether a certificate is valid now
 * @param certificate The certificate.
 * @param now The time.
 */
function validAt(certificate: X509Certificate, now: number): boolean {
    return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo)
}

/**
 * Whether the certificate a client gave over TLS chains to one of the CAs: each certificate valid now and signed by the
 * next (the intermediates CAs), the last issued and signed by a CA of the list, the client's own allowed for client
 * authentication. A socket made by hand for StartTLS does not get `authorized` from Node.js, so the check is done here
 * for every connection.
 * @param socket The socket.
 * @param authorities The CAs.
 */
export function clientCertificateTrusted(socket: tls.TLSSocket, authorities: X509Certificate[]): boolean {
    if (!authorities.length) return false
    const peer: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate?.(true) as tls.DetailedPeerCertificate | undefined
    if (!peer || !peer.raw) return false
    const now: number = Date.now()
    let node: tls.DetailedPeerCertificate = peer
    let current: X509Certificate = new X509Certificate(peer.raw)
    const usages: string[] | undefined = current.keyUsage
    if (usages && !usages.includes(CLIENT_AUTH) && !usages.includes(ANY_PURPOSE)) return false
    for (let depth: number = 0; depth < 10; depth++) {
        if (!validAt(current, now)) return false
        const authority: X509Certificate | undefined = authorities.find((candidate: X509Certificate): boolean => current.checkIssued(candidate) && current.verify(candidate.publicKey))
        if (authority) return validAt(authority, now)
        const next: tls.DetailedPeerCertificate | undefined = node.issuerCertificate
        if (!next || next === node || !next.raw) return false
        const issuer: X509Certificate = new X509Certificate(next.raw)
        if (!issuer.ca || !current.checkIssued(issuer) || !current.verify(issuer.publicKey)) return false
        node = next
        current = issuer
    }
    return false
}
