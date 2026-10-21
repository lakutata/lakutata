import {Exception} from '@lakutata/core'

/**
 * Thrown when a request to `WHIPController` names a session the `WHIP` component does not have (an HTTP 404). Its
 * `errno` is `'E_WHIP_SESSION_NOT_FOUND'`.
 */
export class WHIPSessionNotFoundException extends Exception {
    /**
     * `'E_WHIP_SESSION_NOT_FOUND'`.
     */
    public errno: string | number = 'E_WHIP_SESSION_NOT_FOUND'

    /**
     * The HTTP status of the response: 404.
     */
    public readonly statusCode: number = 404
}
