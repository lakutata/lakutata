import {Exception} from '@lakutata/core'

/**
 * An access control rule denied the request: a rule of the entrypoint (`rules`) or of the action resolved `false`.
 * Its errno is `E_ACCESS_DENY`, its HTTP status 403.
 */
export class AccessDeniedException extends Exception {
    public errno: string | number = 'E_ACCESS_DENY'

    public message: string = 'Access denied'

    public readonly statusCode: number = 403
}