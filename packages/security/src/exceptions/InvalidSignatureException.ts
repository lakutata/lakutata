import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Mac.unsignMessage} when the signed message has no signature or its signature is not valid (the
 * message or the signature was changed, or none of the configured keys signed it); applications may throw it too
 * after {@link verifyHMAC} fails. Its `errno` is `'E_INVALID_SIGNATURE'`; its HTTP status is 500 unless the application
 * handles it.
 */
export class InvalidSignatureException extends Exception {
    /**
     * `'E_INVALID_SIGNATURE'`.
     */
    public errno: string | number = 'E_INVALID_SIGNATURE'
}
