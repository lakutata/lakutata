import {Exception} from '@lakutata/core'

/**
 * The failure of a message whose processing exceeded the `timeout` of its action: the processing is aborted (the
 * signal of its context), and the message is retried as after an error. Its `errno` is
 * `'E_QUEUE_PROCESSING_TIMEOUT'`.
 */
export class QueueProcessingTimeoutException extends Exception {
    /**
     * `'E_QUEUE_PROCESSING_TIMEOUT'`.
     */
    public errno: string | number = 'E_QUEUE_PROCESSING_TIMEOUT'

    /**
     * The HTTP status the transports answer with: 504.
     */
    public statusCode: number = 504
}
