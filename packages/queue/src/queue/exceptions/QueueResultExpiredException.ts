import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Queue.result} (and `job.result()`) when the result of the message was kept, but longer ago than the
 * `results.keep` option of the queue. Its `errno` is `'E_QUEUE_RESULT_EXPIRED'`.
 */
export class QueueResultExpiredException extends Exception {
    /**
     * `'E_QUEUE_RESULT_EXPIRED'`.
     */
    public errno: string | number = 'E_QUEUE_RESULT_EXPIRED'

    /**
     * The HTTP status the transports answer with: 410.
     */
    public statusCode: number = 410
}
