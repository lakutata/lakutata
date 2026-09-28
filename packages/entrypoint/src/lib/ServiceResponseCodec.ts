import {Exception} from '@lakutata/core'
import {ServiceInvokeException} from '../exceptions/ServiceInvokeException.js'

/**
 * The standard response of a service invocation
 */
export interface ServiceResponse {
    readonly success: boolean
    readonly error: Error | Exception | null
    readonly payload: any | null
}

export class ServiceResponseCodec {

    /**
     * A serializable copy of an error: its own properties (message, stack, errno, errMsg, statusCode…)
     * @param error
     */
    public static errorObject(error: unknown): Record<string, unknown> {
        if (!error || typeof error !== 'object') return {message: String(error)}
        const errorObject: Record<string, unknown> = {}
        Object.getOwnPropertyNames(error).forEach((property: string): unknown => errorObject[property] = (error as Record<string, unknown>)[property])
        return errorObject
    }

    /**
     * Encode the failure of a service invocation
     * @param error
     */
    public static encodeError(error: unknown): ServiceResponse {
        return this.encode(this.errorObject(error), true)
    }

    /**
     * Encode service response
     * @param data
     * @param isError
     */
    public static encode(data: any, isError: boolean): ServiceResponse {
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
     * Decode service response
     * @param response
     * @param serviceId
     */
    public static decode(response: ServiceResponse, serviceId?: string): any {
        if (!response.success) {
            const remoteError: any = response.error
            const serviceInvokeException: ServiceInvokeException = new ServiceInvokeException(remoteError?.message || 'Unknown Error')
            if (serviceId) serviceInvokeException.service = serviceId
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
            throw serviceInvokeException
        }
        return response.payload
    }
}