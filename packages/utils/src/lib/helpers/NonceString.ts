import {randomString} from './RandomString.js'

/**
 * Generate a nonce: a random string of 32 letters and digits (`[A-Za-z0-9]`), drawn from the cryptographic random
 * generator. It is `randomString(32, 'alphanumeric')`.
 * @returns A new 32-character string at each call.
 * @example
 * ```typescript
 * import {nonceString} from 'lakutata/utils'
 *
 * const nonce: string = nonceString()
 * console.log(nonce.length)
 * //32
 * ```
 */
export function nonceString(): string {
    return randomString(32, 'alphanumeric')
}
