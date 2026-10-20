import {Exception} from '@lakutata/core'

/**
 * Thrown when a member sends a signal in a room it has not joined, or to a member who is not in it. Its `errno` is
 * `'E_SIGNALING_NOT_A_MEMBER'`.
 */
export class SignalingNotAMemberException extends Exception {
    /**
     * `'E_SIGNALING_NOT_A_MEMBER'`.
     */
    public errno: string | number = 'E_SIGNALING_NOT_A_MEMBER'
}
