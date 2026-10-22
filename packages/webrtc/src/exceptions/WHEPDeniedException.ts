import {Exception} from '@lakutata/core'

/**
 * Thrown when the `authorize` option of the `WHEP` component refuses a stream to its viewer (an HTTP 401). Its
 * `errno` is `'E_WHEP_DENIED'`.
 */
export class WHEPDeniedException extends Exception {
    /**
     * `'E_WHEP_DENIED'`.
     */
    public errno: string | number = 'E_WHEP_DENIED'

    /**
     * The HTTP status of the response: 401.
     */
    public readonly statusCode: number = 401
}
