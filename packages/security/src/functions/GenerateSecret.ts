import {randomBytes} from 'node:crypto'

/**
 * Generate a random secret key from the operating system's cryptographically secure generator (`crypto.randomBytes`),
 * suited to the keys of {@link Mac} and {@link Crypt}, {@link HMAC} and {@link EncryptByKey}, and to random tokens
 * (session IDs, reset links). It is not a password and should be stored as a secret (an environment variable, a vault).
 * @param bytes The number of random bytes; 32 (256 bits) by default, at least 16 for a secret (0 gives an empty
 * string). The keys of {@link Mac} and {@link Crypt} need 12 bytes or more to reach their 16-character minimum.
 * @returns The random bytes, base64url encoded without padding: 43 characters for 32 bytes, 22 for 16.
 * @throws {RangeError} When `bytes` is negative or larger than 2^31 - 1.
 * @example
 * ```typescript
 * import {GenerateSecret} from 'lakutata/security'
 *
 * //A 256-bit key, for MAC_KEY or CRYPT_KEY
 * console.log(GenerateSecret())
 * //A 128-bit token
 * const token: string = GenerateSecret(16)
 * console.log(token)
 * ```
 */
export function GenerateSecret(bytes: number = 32): string {
    return randomBytes(bytes).toString('base64url')
}
