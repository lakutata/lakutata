import {Exception} from '@lakutata/core'

/**
 * The failure of a service invocation: the error of the remote service, with its properties (errno, errMsg, statusCode…)
 */
export class ServiceInvokeException extends Exception {
    public errno: string | number = 'E_SERVICE_INVOKE'

    /**
     * The id of the service invoked.
     */
    public service?: string
}