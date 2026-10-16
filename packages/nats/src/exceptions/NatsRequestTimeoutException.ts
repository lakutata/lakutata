import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when no response arrives within the request's timeout.
 * The request may have been received and processed, its response lost or late: it is never retried. Its `errno` is
 * `E_NATS_REQUEST_TIMEOUT`, its `statusCode` 408.
 */
export class NatsRequestTimeoutException extends Exception {
    public errno: string | number = 'E_NATS_REQUEST_TIMEOUT'
    public statusCode: number = 408

    /**
     * Create the exception: its message is "Request Timeout" unless one is given.
     * @param template The message, or a template filled from the parameters (see `Exception`), or an error whose
     * message it takes; "Request Timeout" by default.
     * @param params The parameters of the template.
     */
    constructor(template?: string | Error, ...params: any[]) {
        super((template ?? 'Request Timeout') as string, ...params)
    }
}
