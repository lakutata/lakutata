import {RandomString} from './RandomString.js'

/**
 * Generate a nonce: a random string of 32 letters and digits (`[A-Za-z0-9]`), drawn from the cryptographic random
 * generator. It is `RandomString(32, 'alphanumeric')`.
 * @returns A new 32-character string at each call.
 * @example
 * ```typescript
 * import {NonceString} from 'lakutata/utils'
 *
 * const nonce: string = NonceString()
 * console.log(nonce.length)
 * //32
 * ```
 */
export function NonceString(): string {
    return RandomString(32, 'alphanumeric')
}
