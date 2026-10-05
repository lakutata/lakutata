import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto'

/**
 * A random key of the process: the compared values are digested with it, so the comparison does not reveal their length
 */
const COMPARISON_KEY: Buffer = randomBytes(32)

/**
 * Compare two secrets (signatures, tokens, API keys) in a time that does not depend on their content or their lengths,
 * so an attacker cannot guess a secret by timing the comparisons. Values of different lengths are compared too, and
 * are unequal. Use it instead of `===` whenever one side is a secret; to check a password, use
 * {@link PasswordHash.validate} instead.
 * @param a The first value: a string (compared as its UTF-8 bytes) or bytes.
 * @param b The second value: a string (compared as its UTF-8 bytes) or bytes.
 * @returns `true` when both values hold the same bytes.
 * @example
 * ```typescript
 * import {constantTimeEqual} from 'lakutata/security'
 *
 * declare const presentedApiKey: string
 *
 * if (!constantTimeEqual(presentedApiKey, process.env.API_KEY ?? '')) throw new Error('Unauthorized')
 * ```
 */
export function constantTimeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
    const digestA: Buffer = createHmac('sha256', COMPARISON_KEY).update(a).digest()
    const digestB: Buffer = createHmac('sha256', COMPARISON_KEY).update(b).digest()
    return timingSafeEqual(digestA, digestB)
}
