import {Exception} from '@lakutata/core'

export class InvalidChannelException extends Exception {
    public errno: string | number = 'E_INVALID_CHANNEL'
}
