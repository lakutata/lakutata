import {Exception} from '@lakutata/core'

/**
 * Thrown when the offer of a publisher is not one the `WHIP` component can answer: not an SDP offer, without audio
 * or video, of a room the media server does not serve, or refused by the connection; or when the fragment of a PATCH
 * has no ICE or is refused (an HTTP 400). Its `errno` is `'E_WHIP_OFFER'`.
 */
export class WHIPOfferException extends Exception {
    /**
     * `'E_WHIP_OFFER'`.
     */
    public errno: string | number = 'E_WHIP_OFFER'

    /**
     * The HTTP status of the response: 400.
     */
    public readonly statusCode: number = 400
}
