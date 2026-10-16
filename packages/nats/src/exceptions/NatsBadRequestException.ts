import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when the request fails with an error of the NATS client
 * whose code is `400` (a bad request). The client reports such codes for some JetStream operations, not for the core
 * requests the component sends, so it is rarely seen. Its `errno` is `E_NATS_BAD_REQUEST`, its `statusCode` 400.
 */
export class NatsBadRequestException extends Exception {
    public errno: string | number = 'E_NATS_BAD_REQUEST'
    public statusCode: number = 400

    /**
     * Create the exception: its message is "Bad Request" unless one is given.
     * @param template The message, or a template filled from the parameters (see `Exception`), or an error whose
     * message it takes; "Bad Request" by default.
     * @param params The parameters of the template.
     */
    constructor(template?: string | Error, ...params: any[]) {
        super((template ?? 'Bad Request') as string, ...params)
    }
}
