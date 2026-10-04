import {Exception} from '@lakutata/core'

/**
 * No HTTP route matches the request (the HTTP adapters answer it). Its errno is `E_ROUTE_NOT_FOUND`, its HTTP status
 * 404.
 */
export class RouteNotFoundException extends Exception {
    public errno: string | number = 'E_ROUTE_NOT_FOUND'

    public readonly statusCode: number = 404
}
