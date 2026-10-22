import {Exception} from '@lakutata/core'

/**
 * Thrown when the `WHEP` component has as many sessions as its `maxSessions` option allows (an HTTP 503). Its
 * `errno` is `'E_WHEP_LIMIT'`.
 */
export class WHEPLimitException extends Exception {
    /**
     * `'E_WHEP_LIMIT'`.
     */
    public errno: string | number = 'E_WHEP_LIMIT'

    /**
     * The HTTP status of the response: 503.
     */
    public readonly statusCode: number = 503
}
