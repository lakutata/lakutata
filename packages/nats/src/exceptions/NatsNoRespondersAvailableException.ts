import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` when no subscription receives the request: nobody listens on the subject (the service is
 * not running, or is stopping). It is thrown at once, without waiting for the timeout, and the request was not
 * processed: `ServiceProxy.invoke()` retries it (`maxRetries` times) before throwing it. Its `errno` is
 * `E_NATS_NO_RESPONDERS_AVAILABLE`, its `statusCode` 503.
 */
export class NatsNoRespondersAvailableException extends Exception {
    public errno: string | number = 'E_NATS_NO_RESPONDERS_AVAILABLE'
    public message: string = 'No Responders Available'
    public statusCode: number = 503
}