import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when the request fails with an error of the NATS client
 * whose code is `403` (a forbidden request). The client reports such codes for some JetStream operations, not for the
 * core requests the component sends, so it is rarely seen. Its `errno` is `E_NATS_FORBIDDEN`, its `statusCode` 403.
 */
export class NatsForbiddenException extends Exception {
    public errno: string | number = 'E_NATS_FORBIDDEN'
    public message: string = 'Forbidden'
    public statusCode: number = 403
}