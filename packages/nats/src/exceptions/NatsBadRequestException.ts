import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when the request fails with an error of the NATS client
 * whose code is `400` (a bad request). The client reports such codes for some JetStream operations, not for the core
 * requests the component sends, so it is rarely seen. Its `errno` is `E_NATS_BAD_REQUEST`, its `statusCode` 400.
 */
export class NatsBadRequestException extends Exception {
    public errno: string | number = 'E_NATS_BAD_REQUEST'
    public message: string = 'Bad Request'
    public statusCode: number = 400
}