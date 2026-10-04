import {createHash} from 'node:crypto'

/**
 * Compute the SHA-1 digest of a string, read as UTF-8. SHA-1 is broken for security: use it for checksums and
 * compatibility, not for signatures.
 * @param message The text to hash; the empty string has a digest too.
 * @returns The 20-byte digest, as a `Buffer`: call `.toString('hex')` or `.toString('base64')` for its text form.
 * @example
 * ```typescript
 * import {SHA1} from 'lakutata/utils'
 *
 * console.log(SHA1('hello').toString('hex'))
 * //aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
 * ```
 */
export function SHA1(message: string): Buffer {
    return createHash('sha1').update(Buffer.from(message)).digest()
}
