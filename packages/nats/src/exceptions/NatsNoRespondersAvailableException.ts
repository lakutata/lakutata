import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` when no subscription receives the request: nobody listens on the subject (the service is
 * not running, or is stopping). It is thrown at once, without waiting for the timeout, and the request was not
 * processed: `ServiceProxy.invoke()` retries it (`maxRetries` times) before throwing it. Its `errno` is
 * `E_NATS_NO_RESPONDERS_AVAILABLE`, its `statusCode` 503.
 */
export class NatsNoRespondersAvailableException extends Exception {
    public errno: string | number = 'E_NATS_NO_RESPONDERS_AVAILABLE'
    public statusCode: number = 503

    /**
     * Create the exception: its message is "No Responders Available" unless one is given.
     * @param template The message, or a template filled from the parameters (see `Exception`), or an error whose
     * message it takes; "No Responders Available" by default.
     * @param params The parameters of the template.
     */
    constructor(template?: string | Error, ...params: any[]) {
        super((template ?? 'No Responders Available') as string, ...params)
    }
}
