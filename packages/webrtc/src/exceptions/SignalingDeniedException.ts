import {Exception} from '@lakutata/core'

/**
 * Thrown when the `authorize` option of the `Signaling` component refuses a member the room it asks to join. Its
 * `errno` is `'E_SIGNALING_DENIED'`.
 */
export class SignalingDeniedException extends Exception {
    /**
     * `'E_SIGNALING_DENIED'`.
     */
    public errno: string | number = 'E_SIGNALING_DENIED'
}
