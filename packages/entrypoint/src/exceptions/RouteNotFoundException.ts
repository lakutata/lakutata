import {Exception} from '@lakutata/core'

export class RouteNotFoundException extends Exception {
    public errno: string | number = 'E_ROUTE_NOT_FOUND'

    public readonly statusCode: number = 404
}
