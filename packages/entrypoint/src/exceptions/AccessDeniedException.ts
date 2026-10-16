import {Exception} from '@lakutata/core'

/**
 * An access control rule denied the request: a rule of the entrypoint (`rules`) or of the action resolved `false`.
 * Its errno is `E_ACCESS_DENY`, its HTTP status 403.
 */
export class AccessDeniedException extends Exception {
    public errno: string | number = 'E_ACCESS_DENY'

    public readonly statusCode: number = 403

    /**
     * Create the exception: its message is "Access denied" unless one is given.
     * @param template The message, or a template filled from the parameters (see `Exception`), or an error whose
     * message it takes; "Access denied" by default.
     * @param params The parameters of the template.
     */
    constructor(template?: string | Error, ...params: any[]) {
        super((template ?? 'Access denied') as string, ...params)
    }
}
