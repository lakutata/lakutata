import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Queue.request} and {@link Queue.result} without a `group` when several groups process the queue:
 * each group has its own result, the call names the one it reads. Its `errno` is `'E_QUEUE_AMBIGUOUS_GROUP'`.
 */
export class QueueAmbiguousGroupException extends Exception {
    /**
     * `'E_QUEUE_AMBIGUOUS_GROUP'`.
     */
    public errno: string | number = 'E_QUEUE_AMBIGUOUS_GROUP'

    /**
     * The HTTP status the transports answer with: 400.
     */
    public statusCode: number = 400
}
