import {Exception} from '@lakutata/core'

export class AccessDenyException extends Exception {
    public errno: string | number = 'E_ACCESS_DENY'

    public message: string = 'Access denied'
}