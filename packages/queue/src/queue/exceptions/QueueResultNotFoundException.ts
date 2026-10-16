import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Queue.result} (and `job.result()`) when no result is kept for the message: it is not processed yet
 * (and the wait timed out, or `wait` is false), or the id is unknown. Its `errno` is `'E_QUEUE_RESULT_NOT_FOUND'`.
 */
export class QueueResultNotFoundException extends Exception {
    /**
     * `'E_QUEUE_RESULT_NOT_FOUND'`.
     */
    public errno: string | number = 'E_QUEUE_RESULT_NOT_FOUND'

    /**
     * The HTTP status the transports answer with: 404.
     */
    public statusCode: number = 404
}
