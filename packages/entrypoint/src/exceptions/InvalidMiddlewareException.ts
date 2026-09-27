import {Exception} from '@lakutata/core'

export class InvalidMiddlewareException extends Exception {
    public errno: string | number = 'E_INVALID_MIDDLEWARE'
}
