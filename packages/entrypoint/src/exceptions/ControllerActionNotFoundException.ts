import {Exception} from '@lakutata/core'

/**
 * No action matches the request: the service pattern, the command or the route of no controller action matches it.
 * Its errno is `E_CONTROLLER_ACTION_NOT_FOUND`, its HTTP status 404.
 */
export class ControllerActionNotFoundException extends Exception {
    public errno: string | number = 'E_CONTROLLER_ACTION_NOT_FOUND'

    public readonly statusCode: number = 404
}
