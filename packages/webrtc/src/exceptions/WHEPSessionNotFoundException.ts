import {Exception} from '@lakutata/core'

/**
 * Thrown when a request to `WHEPController` names a session the `WHEP` component does not have (an HTTP 404). Its
 * `errno` is `'E_WHEP_SESSION_NOT_FOUND'`.
 */
export class WHEPSessionNotFoundException extends Exception {
    /**
     * `'E_WHEP_SESSION_NOT_FOUND'`.
     */
    public errno: string | number = 'E_WHEP_SESSION_NOT_FOUND'

    /**
     * The HTTP status of the response: 404.
     */
    public readonly statusCode: number = 404
}
