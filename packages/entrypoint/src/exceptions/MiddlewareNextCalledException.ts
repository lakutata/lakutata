import {Exception} from '@lakutata/core'

export class MiddlewareNextCalledException extends Exception {
    public errno: string | number = 'E_MIDDLEWARE_NEXT_CALLED'
}
