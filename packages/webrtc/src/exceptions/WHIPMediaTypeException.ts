import {Exception} from '@lakutata/core'

/**
 * Thrown when the body of a request to `WHIPController` is not `application/sdp` (an HTTP 415). Its `errno` is
 * `'E_WHIP_MEDIA_TYPE'`.
 */
export class WHIPMediaTypeException extends Exception {
    /**
     * `'E_WHIP_MEDIA_TYPE'`.
     */
    public errno: string | number = 'E_WHIP_MEDIA_TYPE'

    /**
     * The HTTP status of the response: 415.
     */
    public readonly statusCode: number = 415
}
