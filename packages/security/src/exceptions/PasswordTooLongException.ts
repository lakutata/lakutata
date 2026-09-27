import {Exception} from '@lakutata/core'

export class PasswordTooLongException extends Exception {
    public errno: string | number = 'E_PASSWORD_TOO_LONG'
}
