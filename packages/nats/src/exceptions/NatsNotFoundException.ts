import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when the request fails with an error of the NATS client
 * whose code is `404` (a subject not found). The client reports such codes for some JetStream operations, not for the
 * core requests the component sends, so it is rarely seen. Its `errno` is `E_NATS_NOT_FOUND`, its `statusCode` 404.
 */
export class NatsNotFoundException extends Exception {
    public errno: string | number = 'E_NATS_NOT_FOUND'
    public message: string = 'Subject Not Found'
    public statusCode: number = 404
}