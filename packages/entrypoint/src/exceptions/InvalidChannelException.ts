import {Exception} from '@lakutata/core'

/**
 * A channel is defined twice under the same name, or a channel used is not defined. Its errno is
 * `E_INVALID_CHANNEL`.
 */
export class InvalidChannelException extends Exception {
    public errno: string | number = 'E_INVALID_CHANNEL'
}
