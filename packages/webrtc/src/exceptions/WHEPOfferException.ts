import {Exception} from '@lakutata/core'

/**
 * Thrown when the offer of a viewer is not one the `WHEP` component can answer: not an SDP offer, without audio
 * or video, of a room the media server does not serve, or refused by the connection; or when the fragment of a PATCH
 * has no ICE or is refused (an HTTP 400). Its `errno` is `'E_WHEP_OFFER'`.
 */
export class WHEPOfferException extends Exception {
    /**
     * `'E_WHEP_OFFER'`.
     */
    public errno: string | number = 'E_WHEP_OFFER'

    /**
     * The HTTP status of the response: 400.
     */
    public readonly statusCode: number = 400
}
