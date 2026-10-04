import {Exception} from '@lakutata/core'

/**
 * A middleware is neither a function nor a class extending `Middleware`, when the entrypoint initializes. Its errno is
 * `E_INVALID_MIDDLEWARE`.
 */
export class InvalidMiddlewareException extends Exception {
    public errno: string | number = 'E_INVALID_MIDDLEWARE'
}
