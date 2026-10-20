import {createHmac} from 'node:crypto'

/**
 * Short-lived TURN credentials (the REST API of coturn): the username is `<expiry>:<user>` (the expiry in seconds since
 * the epoch), the password `base64(HMAC-SHA1(secret, username))`. A TURN server holding the secret checks them without
 * storing them; an external coturn configured with the same secret (`use-auth-secret`) accepts them as well.
 */
export interface TURNCredentials {
    /**
     * The username: `<expiry>:<user>`.
     */
    username: string
    /**
     * The password.
     */
    credential: string
    /**
     * How long they are valid from now, in seconds.
     */
    ttl: number
}

/**
 * Create short-lived TURN credentials.
 * @param secret The secret shared with the TURN server.
 * @param user The user the credentials are for (the part of the username after the expiry); it may not hold `:`.
 * @param ttl How long they are valid, in seconds.
 * @param now The current time in milliseconds (for tests).
 * @returns The credentials.
 * @example
 * ```typescript
 * import {createTURNCredentials, type TURNCredentials} from '@lakutata/webrtc'
 *
 * //Valid for an hour, for the user alice: {username: '1767229200:alice', credential: '…', ttl: 3600}
 * const credentials: TURNCredentials = createTURNCredentials('the shared secret', 'alice', 3600)
 * ```
 */
export function createTURNCredentials(secret: string, user: string, ttl: number, now: number = Date.now()): TURNCredentials {
    const username: string = `${Math.floor(now / 1000) + Math.floor(ttl)}:${user.replaceAll(':', '_')}`
    return {username: username, credential: turnPassword(secret, username), ttl: Math.floor(ttl)}
}

/**
 * The password of a username of short-lived credentials
 * @param secret
 * @param username
 */
export function turnPassword(secret: string, username: string): string {
    return createHmac('sha1', secret).update(username).digest('base64')
}

/**
 * The password of a username when its credentials are short-lived ones of the secret and not expired; undefined
 * otherwise (for the TURN server: an unknown user)
 * @param secret
 * @param username
 * @param now
 */
export function turnPasswordIfValid(secret: string, username: string, now: number = Date.now()): string | undefined {
    const separator: number = username.indexOf(':')
    if (separator <= 0) return undefined
    const expiry: number = Number(username.slice(0, separator))
    if (!Number.isFinite(expiry) || expiry * 1000 < now) return undefined
    return turnPassword(secret, username)
}
