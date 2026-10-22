import {Exception} from '@lakutata/core'

/**
 * Thrown when the body of a request to `WHEPController` is not `application/sdp` (a POST) or
 * `application/trickle-ice-sdpfrag` (a PATCH): an HTTP 415. Its `errno` is `'E_WHEP_MEDIA_TYPE'`.
 */
export class WHEPMediaTypeException extends Exception {
    /**
     * `'E_WHEP_MEDIA_TYPE'`.
     */
    public errno: string | number = 'E_WHEP_MEDIA_TYPE'

    /**
     * The HTTP status of the response: 415.
     */
    public readonly statusCode: number = 415
}
