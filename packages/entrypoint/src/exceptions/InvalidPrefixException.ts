import {Exception} from '@lakutata/core'

export class InvalidPrefixException extends Exception {
    public errno: string | number = 'E_INVALID_PREFIX'
}
