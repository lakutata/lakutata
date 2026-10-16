import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Queue.request} when the reply does not come in time. The message stays in the queue and may still be
 * processed: its result can be read later by its id (`queue.result()`), while it is kept. Its `errno` is
 * `'E_QUEUE_REQUEST_TIMEOUT'`.
 */
export class QueueRequestTimeoutException extends Exception {
    /**
     * `'E_QUEUE_REQUEST_TIMEOUT'`.
     */
    public errno: string | number = 'E_QUEUE_REQUEST_TIMEOUT'

    /**
     * The HTTP status the transports answer with: 504.
     */
    public statusCode: number = 504
}
