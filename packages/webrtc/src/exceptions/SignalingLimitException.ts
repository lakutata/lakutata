import {Exception} from '@lakutata/core'

/**
 * Thrown when a member goes over a limit of the `Signaling` component: the size of a message, the messages per
 * second, the members of a room. Its `errno` is `'E_SIGNALING_LIMIT'`.
 */
export class SignalingLimitException extends Exception {
    /**
     * `'E_SIGNALING_LIMIT'`.
     */
    public errno: string | number = 'E_SIGNALING_LIMIT'
}
