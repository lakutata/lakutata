import {createHash} from 'node:crypto'

/**
 * Compute the MD5 digest of a string, read as UTF-8. MD5 is broken for security: use it for checksums and cache keys,
 * not for passwords or signatures.
 * @param message The text to hash; the empty string has a digest too.
 * @returns The 16-byte digest, as a `Buffer`: call `.toString('hex')` or `.toString('base64')` for its text form.
 * @example
 * ```typescript
 * import {MD5} from 'lakutata/utils'
 *
 * console.log(MD5('hello').toString('hex'))
 * //5d41402abc4b2a76b9719d911017c592
 * ```
 */
export function MD5(message: string): Buffer {
    return createHash('md5').update(Buffer.from(message)).digest()
}
