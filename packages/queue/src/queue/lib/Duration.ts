import {parseDuration} from '@lakutata/entrypoint'

/**
 * A duration: milliseconds, or a text of `parseDuration` (`'500ms'`, `'30s'`, `'5m'`, `'1h 30m'`, `'1d'`).
 */
export type Duration = number | string

/**
 * A duration in milliseconds: 0 for 0 (no delay), else `parseDuration` (positive)
 * @param duration
 * @internal
 */
export function milliseconds(duration: Duration): number {
    if (duration === 0 || duration === '0') return 0
    return parseDuration(duration)
}
