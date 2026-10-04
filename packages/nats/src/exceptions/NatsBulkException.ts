import {Exception} from '@lakutata/core'

/**
 * A failure of the bulk channel, which relays the large payloads through a JetStream object store; its message tells
 * the cause:
 * - `bulk channel is not enabled`: `putBulk()` or `getBulk()` called, or a reference received, while the channel is
 *   disabled (the `bulk` option is `false`, or the channel failed to start);
 * - `bulk put failed: …` / `bulk get failed: …`: the object store rejected the write or the read;
 * - `bulk object not found: <id>`: the referenced object is gone (its time to live passed) or is in another bucket
 *   (the peers do not share their `bulkBucket`).
 *
 * `NATS.request()` and `ServiceProxy.invoke()` throw it when the large request cannot be stored or the large response
 * cannot be read; `ServiceProxy.invoke()` never retries it, since the service may have processed the request. On the
 * service side, the failure is answered to the requester, which receives a `ServiceInvokeException` whose `errno` is
 * `E_NATS_BULK`. Its `errno` is `E_NATS_BULK`, its `statusCode` 502.
 */
export class NatsBulkException extends Exception {
    public errno: string | number = 'E_NATS_BULK'
    public statusCode: number = 502
}
