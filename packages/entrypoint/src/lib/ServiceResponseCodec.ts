import {Exception} from '@lakutata/core'
import {ServiceInvokeException} from '../exceptions/ServiceInvokeException.js'
import {ActionResult} from './ActionResult.js'
import {StatusResult} from './Result.js'

/**
 * The response of a service invocation, as the service transports (Socket.IO, Electron IPC, NATS…) send it.
 */
export interface ServiceResponse {
    /**
     * Whether the invocation succeeded.
     */
    readonly success: boolean
    /**
     * The failure: a serializable copy of the error's own properties (see {@link ServiceResponseCodec.errorObject});
     * `null` on success.
     */
    readonly error: Error | Exception | null
    /**
     * The action's result; `null` on failure.
     */
    readonly payload: any | null
}

/**
 * Encode the results and failures of service invocations as {@link ServiceResponse}s, and decode them on the
 * caller's side. Used by the service adapters and the service clients; all its methods are static.
 * @example
 * ```typescript
 * import {ServiceResponseCodec, type ServiceResponse} from '@lakutata/entrypoint/channel'
 *
 * //On the service side
 * const ok: ServiceResponse = ServiceResponseCodec.encode({id: 1}, false)
 * const failed: ServiceResponse = ServiceResponseCodec.encodeError(new Error('Not found'))
 *
 * //On the caller side
 * console.log(ServiceResponseCodec.decode(ok)) //{id: 1}
 * try {
 *     ServiceResponseCodec.decode(failed, 'order.service')
 * } catch (error) {
 *     console.log((error as Error).message) //Not found (a ServiceInvokeException whose service is order.service)
 * }
 * ```
 */
export class ServiceResponseCodec {

    /**
     * Copy an error into a serializable object: its own properties (message, stack, errno, errMsg, statusCode…). The
     * values are copied as they are, not deeply.
     * @param error The error; a value which is not an object gives `{message: String(error)}`.
     * @returns The copy.
     */
    public static errorObject(error: unknown): Record<string, unknown> {
        if (!error || typeof error !== 'object') return {message: String(error)}
        const errorObject: Record<string, unknown> = {}
        Object.getOwnPropertyNames(error).forEach((property: string): unknown => errorObject[property] = (error as Record<string, unknown>)[property])
        return errorObject
    }

    /**
     * Encode the failure of a service invocation.
     * @param error The error, copied with {@link ServiceResponseCodec.errorObject}.
     * @returns A failed response.
     */
    public static encodeError(error: unknown): ServiceResponse {
        return this.encode(this.errorObject(error), true)
    }

    /**
     * The payload of an action's result for the service transports: the data of a `StatusResult` (its status and
     * headers are HTTP's), the result itself otherwise.
     * @param result The value the action returned.
     * @returns The payload to send.
     * @throws {TypeError} When it is a `FileResult` or an `EventsResult`, which only the HTTP adapters can send.
     */
    public static payload(result: unknown): unknown {
        if (result instanceof StatusResult) return result.data
        if (result instanceof ActionResult) throw new TypeError(`The service transports cannot send a ${result.constructor.name}: only the HTTP adapters send files and event streams`)
        return result
    }

    /**
     * Encode a service response.
     * @param data The result (a `StatusResult` sent as its data, see {@link ServiceResponseCodec.payload}), or the
     * error when `isError` is `true` (stored as it is: use {@link ServiceResponseCodec.encodeError} to make an error
     * serializable).
     * @param isError Whether `data` is an error.
     * @returns The response.
     * @throws {TypeError} When the result is a `FileResult` or an `EventsResult`.
     */
    public static encode(data: any, isError: boolean): ServiceResponse {
        if (!isError) data = this.payload(data)
        return isError ? {
            success: false,
            error: data,
            payload: null
        } : {
            success: true,
            error: null,
            payload: data
        }
    }

    /**
     * Decode a service response: return its payload, or throw its error.
     * @param response The response.
     * @param serviceId The invoked service's id, set to the exception's `service`.
     * @returns The payload of a successful response.
     * @throws {ServiceInvokeException} When the response is a failure: its message is the remote error's message
     * (`Unknown Error` without one), the remote error's enumerable properties (errno, statusCode…) are copied onto it,
     * the read-only ones skipped.
     */
    public static decode(response: ServiceResponse, serviceId?: string): any {
        if (!response.success) {
            const remoteError: any = response.error
            const serviceInvokeException: ServiceInvokeException = new ServiceInvokeException(remoteError?.message || 'Unknown Error')
            //The properties of the remote error are copied one by one, the read-only ones (such as the name of a NatsError) are skipped
            if (remoteError && typeof remoteError === 'object') {
                for (const key of Object.keys(remoteError)) {
                    try {
                        (serviceInvokeException as any)[key] = remoteError[key]
                    } catch {
                        //A read-only property
                    }
                }
            }
            //The service invoked, whatever the remote error holds
            if (serviceId) serviceInvokeException.service = serviceId
            throw serviceInvokeException
        }
        return response.payload
    }
}