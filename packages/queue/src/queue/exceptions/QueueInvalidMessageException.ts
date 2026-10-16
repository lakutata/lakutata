import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Queue.add} (and `request()`) when the queue name is empty, or the message is not an object: a
 * message is the input of the action processing it. Its `errno` is `'E_QUEUE_INVALID_MESSAGE'`.
 */
export class QueueInvalidMessageException extends Exception {
    /**
     * `'E_QUEUE_INVALID_MESSAGE'`.
     */
    public errno: string | number = 'E_QUEUE_INVALID_MESSAGE'

    /**
     * The HTTP status the transports answer with: 400.
     */
    public statusCode: number = 400
}
