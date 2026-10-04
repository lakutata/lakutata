import {createHash, randomBytes} from 'node:crypto'

/**
 * The token of a lock acquired (its holder checked by it)
 */
export function LockToken(): string {
    return randomBytes(16).toString('hex')
}

/**
 * The digest of the name of a lock (hexadecimal)
 * @param name
 */
export function NameDigest(name: string): string {
    return createHash('sha256').update(name).digest('hex')
}

/**
 * The key of 64 bits of the name of a lock (the advisory locks of PostgreSQL), a signed bigint as a string
 * @param name
 */
export function NameKey64(name: string): string {
    return createHash('sha256').update(name).digest().readBigInt64BE(0).toString()
}
