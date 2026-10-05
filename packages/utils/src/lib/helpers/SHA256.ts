import {createHash} from 'node:crypto'

/**
 * Compute the SHA-256 digest of a string, read as UTF-8.
 * @param message The text to hash; the empty string has a digest too.
 * @returns The 32-byte digest, as a `Buffer`: call `.toString('hex')` or `.toString('base64')` for its text form.
 * @example
 * ```typescript
 * import {sha256} from 'lakutata/utils'
 *
 * console.log(sha256('hello').toString('hex'))
 * //2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
 * ```
 */
export function sha256(message: string): Buffer {
    return createHash('sha256').update(Buffer.from(message)).digest()
}
