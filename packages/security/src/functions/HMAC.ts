import {createHmac} from 'node:crypto'
import {TimingSafeEqual} from './TimingSafeEqual.js'

/**
 * The hash algorithms of the signatures
 */
export type HMACAlgorithm = 'sha256' | 'sha384' | 'sha512'

/**
 * Sign data: its HMAC with a key, base64url encoded
 * @param data
 * @param key
 * @param algorithm (default sha256)
 */
export function HMAC(data: string | Uint8Array, key: string | Uint8Array, algorithm: HMACAlgorithm = 'sha256'): string {
    return createHmac(algorithm, key).update(data).digest('base64url')
}

/**
 * Whether a signature is the signature of data with a key (compared in constant time)
 * @param data
 * @param signature
 * @param key
 * @param algorithm (default sha256)
 */
export function VerifyHMAC(data: string | Uint8Array, signature: string, key: string | Uint8Array, algorithm: HMACAlgorithm = 'sha256'): boolean {
    return TimingSafeEqual(HMAC(data, key, algorithm), signature)
}
