import {Exception} from '@lakutata/core'

/**
 * Thrown when the `WHIP` component has as many sessions as its `maxSessions` option allows (an HTTP 503). Its
 * `errno` is `'E_WHIP_LIMIT'`.
 */
export class WHIPLimitException extends Exception {
    /**
     * `'E_WHIP_LIMIT'`.
     */
    public errno: string | number = 'E_WHIP_LIMIT'

    /**
     * The HTTP status of the response: 503.
     */
    public readonly statusCode: number = 503
}
