import {Exception} from '@lakutata/core'

/**
 * A service called by an `HTTPServiceProxy` gave no response: it could not be reached, it did not answer in time, or
 * its answer was not a service response (the error page of a proxy in front of it…). Its `cause` is the error of the
 * request when there is one, its `service` the address of the service. Its errno is `E_SERVICE_UNAVAILABLE`, its HTTP
 * status 503. The failures of the actions themselves are thrown as `ServiceInvokeException`.
 */
export class ServiceUnavailableException extends Exception {
    public errno: string | number = 'E_SERVICE_UNAVAILABLE'

    public readonly statusCode: number = 503

    /**
     * The address of the service called.
     */
    public service?: string
}
