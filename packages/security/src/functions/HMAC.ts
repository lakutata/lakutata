import {createHmac} from 'node:crypto'
import {TimingSafeEqual} from './TimingSafeEqual.js'
import {AssertKey} from '../lib/AssertKey.js'

/**
 * The hash functions of the HMAC signatures: `'sha256'` (43-character signatures), `'sha384'` (64) or `'sha512'` (86).
 */
export type HMACAlgorithm = 'sha256' | 'sha384' | 'sha512'

/**
 * Sign data with a key: compute its HMAC, a keyed hash that only a holder of the key can produce. Use it to detect
 * tampering (webhooks, signed links); it does not hide the data, and is not a password hash. The {@link Mac} provider
 * does the same with configured keys and key rotation.
 * @param data The data to sign: a string (signed as its UTF-8 bytes) or bytes.
 * @param key The secret key: a string (used as its UTF-8 bytes, not decoded) or bytes, not empty. Use a random key of
 * 32 bytes, such as {@link GenerateKey} returns.
 * @param algorithm The hash function; `'sha256'` by default.
 * @returns The HMAC, base64url encoded without padding.
 * @throws {RangeError} When the key is empty.
 * @example
 * ```typescript
 * import {GenerateKey, HMAC, VerifyHMAC} from 'lakutata/security'
 *
 * const key: string = process.env.WEBHOOK_KEY ?? GenerateKey()
 * const body: string = JSON.stringify({order: 42, status: 'paid'})
 * //Sent in a header along with the body
 * const signature: string = HMAC(body, key, 'sha256')
 * console.log(VerifyHMAC(body, signature, key, 'sha256'))
 * ```
 */
export function HMAC(data: string | Uint8Array, key: string | Uint8Array, algorithm: HMACAlgorithm = 'sha256'): string {
    AssertKey(key)
    return createHmac(algorithm, key).update(data).digest('base64url')
}

/**
 * Check that a signature is the HMAC of data with a key, in a time that does not depend on the signature (see
 * {@link TimingSafeEqual}).
 * @param data The signed data, exactly as it was signed (the raw request body, not a re-serialized copy).
 * @param signature The signature to check, base64url encoded without padding as {@link HMAC} returns it; a hex or
 * padded signature does not match.
 * @param key The secret key the data was signed with: a string (used as its UTF-8 bytes) or bytes, not empty.
 * @param algorithm The hash function the data was signed with; `'sha256'` by default.
 * @returns `true` when the signature matches.
 * @throws {RangeError} When the key is empty.
 * @example
 * ```typescript
 * import {InvalidSignatureException, VerifyHMAC} from 'lakutata/security'
 *
 * declare const rawBody: string
 * declare const signatureHeader: string
 * declare const webhookKey: string
 *
 * if (!VerifyHMAC(rawBody, signatureHeader, webhookKey)) {
 *     throw new InvalidSignatureException('The signature of the webhook is not valid')
 * }
 * ```
 */
export function VerifyHMAC(data: string | Uint8Array, signature: string, key: string | Uint8Array, algorithm: HMACAlgorithm = 'sha256'): boolean {
    return TimingSafeEqual(HMAC(data, key, algorithm), signature)
}
