import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto'

/**
 * A random key of the process: the compared values are digested with it, so the comparison does not reveal their length
 */
const COMPARISON_KEY: Buffer = randomBytes(32)

/**
 * Compare two values in a time which does not depend on where they differ (for secrets: signatures, tokens)
 * @param a
 * @param b
 */
export function TimingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
    const digestA: Buffer = createHmac('sha256', COMPARISON_KEY).update(a).digest()
    const digestB: Buffer = createHmac('sha256', COMPARISON_KEY).update(b).digest()
    return timingSafeEqual(digestA, digestB)
}
