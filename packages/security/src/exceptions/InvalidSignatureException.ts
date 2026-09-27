import {Exception} from '@lakutata/core'

export class InvalidSignatureException extends Exception {
    public errno: string | number = 'E_INVALID_SIGNATURE'
}
