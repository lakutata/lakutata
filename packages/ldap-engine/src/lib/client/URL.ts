import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {SearchScope} from '../protocol/Messages.js'

/**
 * An LDAP URL (RFC 4516): how to reach a server, and for a referral, what to search there
 */
export interface LDAPURL {
    /**
     * `ldap` (plain, StartTLS possible), `ldaps` (TLS from the start) or `ldapi` (a Unix socket)
     */
    scheme: 'ldap' | 'ldaps' | 'ldapi'
    /**
     * The host, without the brackets of an IPv6 address; empty for `ldapi`
     */
    host: string
    /**
     * The port: 389 for `ldap`, 636 for `ldaps` by default; 0 for `ldapi`
     */
    port: number
    /**
     * The path of the Unix socket of `ldapi`
     */
    path?: string
    /**
     * The DN of the URL
     */
    dn?: string
    /**
     * The attributes of the URL
     */
    attributes?: string[]
    /**
     * The scope of the URL
     */
    scope?: SearchScope
    /**
     * The filter of the URL
     */
    filter?: string
}

/**
 * Parse an LDAP URL (RFC 4516): `ldap://host:389`, `ldaps://[::1]`, `ldapi://%2Fvar%2Frun%2Fslapd%2Fldapi`,
 * `ldap://host/dc=example,dc=com?cn,mail?sub?(objectClass=person)`
 * @param text The URL.
 * @example
 * ```typescript
 * import {parseLDAPURL} from '@lakutata/ldap-engine'
 *
 * console.log(parseLDAPURL('ldaps://dc1.example.com/dc=example,dc=com?cn?sub?(uid=alice)'))
 * ```
 */
export function parseLDAPURL(text: string): LDAPURL {
    const match: RegExpExecArray | null = /^(ldaps?|ldapi):\/\/([^/?]*)(?:\/([^?]*)(?:\?([^?]*)(?:\?([^?]*)(?:\?([^?]*))?)?)?)?/i.exec(text.trim())
    if (!match) throw new LDAPUsageException(`${text} is not an LDAP URL`)
    const scheme: LDAPURL['scheme'] = match[1].toLowerCase() as LDAPURL['scheme']
    const url: LDAPURL = {scheme: scheme, host: '', port: 0}
    const authority: string = decodeURIComponent(match[2])
    if (scheme === 'ldapi') {
        url.path = authority || '/var/run/ldapi'
    } else {
        const hostMatch: RegExpExecArray | null = /^(?:\[([^\]]+)\]|([^:]*))(?::(\d+))?$/.exec(authority)
        if (!hostMatch) throw new LDAPUsageException(`${text} has an invalid host`)
        url.host = hostMatch[1] ?? hostMatch[2] ?? ''
        if (!url.host) url.host = 'localhost'
        url.port = hostMatch[3] ? Number(hostMatch[3]) : scheme === 'ldaps' ? 636 : 389
    }
    if (match[3]) url.dn = decodeURIComponent(match[3])
    if (match[4]) url.attributes = decodeURIComponent(match[4]).split(',').filter((attribute: string): boolean => attribute.length > 0)
    if (match[5]) {
        const scope: string = decodeURIComponent(match[5]).toLowerCase()
        if (scope !== 'base' && scope !== 'one' && scope !== 'sub' && scope !== 'children') throw new LDAPUsageException(`${scope} is not a scope`)
        url.scope = scope
    }
    if (match[6]) url.filter = decodeURIComponent(match[6])
    return url
}
