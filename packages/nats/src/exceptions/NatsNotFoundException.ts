import {Exception} from '@lakutata/core'

/**
 * Thrown by `NATS.request()` (and so `ServiceProxy.invoke()`) when the request fails with an error of the NATS client
 * whose code is `404` (a subject not found). The client reports such codes for some JetStream operations, not for the
 * core requests the component sends, so it is rarely seen. Its `errno` is `E_NATS_NOT_FOUND`, its `statusCode` 404.
 */
export class NatsNotFoundException extends Exception {
    public errno: string | number = 'E_NATS_NOT_FOUND'
    public statusCode: number = 404

    /**
     * Create the exception: its message is "Subject Not Found" unless one is given.
     * @param template The message, or a template filled from the parameters (see `Exception`), or an error whose
     * message it takes; "Subject Not Found" by default.
     * @param params The parameters of the template.
     */
    constructor(template?: string | Error, ...params: any[]) {
        super((template ?? 'Subject Not Found') as string, ...params)
    }
}
