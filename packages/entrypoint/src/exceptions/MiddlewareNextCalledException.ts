import {Exception} from '@lakutata/core'

/**
 * A middleware called `next()` more than once for a request (the request rejects with it). Its errno is
 * `E_MIDDLEWARE_NEXT_CALLED`.
 */
export class MiddlewareNextCalledException extends Exception {
    public errno: string | number = 'E_MIDDLEWARE_NEXT_CALLED'
}
