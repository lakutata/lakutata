import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when no response arrives within the request's timeout.
 * The request may have been received and processed, its response lost or late: it is never retried. Its `errno` is
 * `E_NATS_REQUEST_TIMEOUT`, its `statusCode` 408.
 */
export class NatsRequestTimeoutException extends Exception {
    public errno: string | number = 'E_NATS_REQUEST_TIMEOUT'
    public message: string = 'Request Timeout'
    public statusCode: number = 408
}