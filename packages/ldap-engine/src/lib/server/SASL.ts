import {DN} from '../dn/DN.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {fail} from './EntryTools.js'
import type {ServerSession} from './Types.js'

/**
 * What a SASL mechanism is run with
 */
export interface SASLContext {
    /**
     * The session
     */
    readonly session: ServerSession
    /**
     * The state of the exchange, kept between its steps
     */
    readonly state: Map<string, unknown>
    /**
     * Check the password of a DN as a simple bind does (the backend, the password schemes, the throttle)
     * @param dn The DN.
     * @param password The password.
     */
    verifyPassword(dn: DN, password: Buffer): Promise<boolean>
}

/**
 * A step of a SASL exchange: done with the identity bound, or more to come with the credentials of the server
 */
export interface SASLStep {
    /**
     * Whether the exchange is over; it then succeeded (a failure throws)
     */
    done: boolean
    /**
     * The identity the session is bound as, when done
     */
    identity?: DN
    /**
     * The credentials of the server for the client
     */
    serverCredentials?: Buffer
}

/**
 * A SASL mechanism of the server: one step or several, its state kept in the context between them. A failure throws an
 * `LDAPResultException` (invalidCredentials, inappropriateAuthentication…).
 */
export interface SASLMechanism {
    /**
     * Its name (`PLAIN`, `EXTERNAL`)
     */
    readonly name: string
    /**
     * Whether it is offered only over TLS (true by default)
     */
    readonly requiresTLS?: boolean
    /**
     * The first step, with the initial credentials of the client
     * @param context The context.
     * @param credentials The credentials.
     */
    start(context: SASLContext, credentials?: Buffer): Promise<SASLStep>
    /**
     * A next step, with the credentials of the client
     * @param context The context.
     * @param credentials The credentials.
     */
    step?(context: SASLContext, credentials?: Buffer): Promise<SASLStep>
}

/**
 * The DN of a name: `dn:` and a DN, or a DN
 * @param name The name.
 */
export function dnOfName(name: string): DN | undefined {
    const text: string = name.startsWith('dn:') ? name.slice(3) : name
    return text && DN.isValid(text) ? DN.parse(text) : undefined
}

/**
 * The PLAIN mechanism (RFC 4616): an authorization identity (empty, or the same as the authentication one), the name
 * and the password, checked as a simple bind
 * @param identityOf The DN of a name; by default `dn:` and a DN, or a DN.
 * @example
 * ```typescript
 * import {DN, plainMechanism, type SASLMechanism} from '@lakutata/ldap-engine'
 *
 * //alice is uid=alice,ou=people,dc=example,dc=com
 * const plain: SASLMechanism = plainMechanism((name: string) => DN.parse(`uid=${name},ou=people,dc=example,dc=com`))
 * ```
 */
export function plainMechanism(identityOf: (name: string, session: ServerSession) => DN | undefined | Promise<DN | undefined> = dnOfName): SASLMechanism {
    return {
        name: 'PLAIN',
        start: async (context: SASLContext, credentials?: Buffer): Promise<SASLStep> => {
            if (!credentials) return {done: false, serverCredentials: Buffer.alloc(0)}
            return verifyPlain(context, credentials, identityOf)
        },
        step: async (context: SASLContext, credentials?: Buffer): Promise<SASLStep> => verifyPlain(context, credentials ?? Buffer.alloc(0), identityOf)
    }
}

/**
 * Check the credentials of PLAIN
 * @param context The context.
 * @param credentials The credentials.
 * @param identityOf The DN of a name.
 */
async function verifyPlain(context: SASLContext, credentials: Buffer, identityOf: (name: string, session: ServerSession) => DN | undefined | Promise<DN | undefined>): Promise<SASLStep> {
    const first: number = credentials.indexOf(0)
    const second: number = first < 0 ? -1 : credentials.indexOf(0, first + 1)
    if (first < 0 || second < 0) fail(ResultCode.protocolError, 'The credentials of PLAIN are authzid NUL authcid NUL password')
    const authzid: string = credentials.subarray(0, first).toString('utf8')
    const authcid: string = credentials.subarray(first + 1, second).toString('utf8')
    const password: Buffer = credentials.subarray(second + 1)
    if (authzid && authzid !== authcid && authzid !== `dn:${authcid}`) fail(ResultCode.inappropriateAuthentication, 'An authorization identity other than the authentication identity')
    const dn: DN | undefined = await identityOf(authcid, context.session)
    if (!dn || !password.length || !await context.verifyPassword(dn, password)) fail(ResultCode.invalidCredentials, 'Invalid credentials')
    return {done: true, identity: dn}
}

/**
 * The EXTERNAL mechanism (RFC 4422): the identity is the certificate the client gave over TLS, as the function given
 * maps it to a DN (none by default, which refuses every bind). The certificate must chain to the CA of the server: its
 * `tls` option needs `requestCert: true` and the CA of the client certificates in `ca`.
 * @param identityOf The DN of a certificate, in DER.
 * @example
 * ```typescript
 * import {X509Certificate} from 'node:crypto'
 * import {DN, externalMechanism, type SASLMechanism} from '@lakutata/ldap-engine'
 *
 * //The subject of the certificate is the DN: CN=alice,OU=people,DC=example,DC=com
 * const external: SASLMechanism = externalMechanism((certificate: Buffer) => DN.parse(new X509Certificate(certificate).subject.split('\n').reverse().join(',')))
 * ```
 */
export function externalMechanism(identityOf?: (certificate: Buffer, session: ServerSession) => DN | undefined | Promise<DN | undefined>): SASLMechanism {
    return {
        name: 'EXTERNAL',
        start: async (context: SASLContext, credentials?: Buffer): Promise<SASLStep> => {
            const certificate: Buffer | undefined = context.session.peerCertificate
            if (!certificate || !identityOf) fail(ResultCode.inappropriateAuthentication, 'No client certificate identifies the session')
            if (!context.session.peerCertificateVerified) fail(ResultCode.invalidCredentials, 'The client certificate does not chain to the CA of the server')
            const dn: DN | undefined = await identityOf(certificate, context.session)
            if (!dn) fail(ResultCode.invalidCredentials, 'The client certificate is not mapped to an identity')
            const authzid: string = credentials?.toString('utf8') ?? ''
            if (authzid && !dnOfName(authzid)?.equals(dn)) fail(ResultCode.inappropriateAuthentication, 'An authorization identity other than the certificate\'s')
            return {done: true, identity: dn}
        }
    }
}
