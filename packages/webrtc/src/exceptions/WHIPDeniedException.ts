import {Exception} from '@lakutata/core'

/**
 * Thrown when the `authorize` option of the `WHIP` component refuses a stream to its publisher (an HTTP 401). Its
 * `errno` is `'E_WHIP_DENIED'`.
 */
export class WHIPDeniedException extends Exception {
    /**
     * `'E_WHIP_DENIED'`.
     */
    public errno: string | number = 'E_WHIP_DENIED'

    /**
     * The HTTP status of the response: 401.
     */
    public readonly statusCode: number = 401
}
