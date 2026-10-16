import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when the request fails with an error of the NATS client
 * whose code is `500` (an internal error of the server). The client reports such codes for some JetStream operations,
 * not for the core requests the component sends, so it is rarely seen. Its `errno` is `E_NATS_INTERNAL_SERVER`, its
 * `statusCode` 500.
 */
export class NatsInternalServerException extends Exception {
    public errno: string | number = 'E_NATS_INTERNAL_SERVER'
    public statusCode: number = 500

    /**
     * Create the exception: its message is "Internal Server Error" unless one is given.
     * @param template The message, or a template filled from the parameters (see `Exception`), or an error whose
     * message it takes; "Internal Server Error" by default.
     * @param params The parameters of the template.
     */
    constructor(template?: string | Error, ...params: any[]) {
        super((template ?? 'Internal Server Error') as string, ...params)
    }
}
