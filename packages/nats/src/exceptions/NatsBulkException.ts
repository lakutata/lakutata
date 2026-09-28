import {Exception} from '@lakutata/core'

/**
 * A failure of the bulk channel (a put or get of the object store failed, an expired reference, the bulk channel disabled…),
 * distinct from the failures of the services; it must not be retried (the service may have processed the request).
 * The message tells the cause
 */
export class NatsBulkException extends Exception {
    public errno: string | number = 'E_NATS_BULK'
    public statusCode: number = 502
}
