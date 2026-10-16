import {type Duration, milliseconds} from './Duration.js'

/**
 * The wait before a message is delivered again after its processing failed: a fixed duration, or a policy
 * (`'exponential'` doubles the delay after each failed attempt, up to `max`).
 */
export type Backoff = Duration | {
    /**
     * `'fixed'`: the same delay after each failed attempt; `'exponential'`: the delay doubled after each one.
     */
    type: 'fixed' | 'exponential'
    /**
     * The delay after the first failed attempt.
     */
    delay: Duration
    /**
     * The longest delay (exponential).
     * @default no limit
     */
    max?: Duration
}

/**
 * The delay before the delivery following a failed attempt, in milliseconds
 * @param backoff
 * @param attempt the attempt which failed (1 for the first delivery)
 * @internal
 */
export function backoffDelay(backoff: Backoff, attempt: number): number {
    if (typeof backoff === 'number' || typeof backoff === 'string') return milliseconds(backoff)
    const delay: number = milliseconds(backoff.delay)
    if (backoff.type === 'fixed') return delay
    const grown: number = delay * 2 ** Math.max(0, attempt - 1)
    return backoff.max === undefined ? grown : Math.min(grown, milliseconds(backoff.max))
}
