import {Exception} from '@lakutata/core'

/**
 * The last error of a failed message, as the queue keeps and sends it: its name, its message, and its other fields
 * (its `errno`...).
 */
export type QueueJobError = {
    /**
     * The name of the error class (`'InvalidValueException'`...).
     */
    name: string
    /**
     * The message of the error.
     */
    message: string
    /**
     * The other enumerable fields of the error, encodable ones only.
     */
    [field: string]: unknown
}

/**
 * Thrown by {@link Queue.request}, {@link Queue.result} and `job.result()` when the message failed: its last attempt
 * threw (it went to the dead letter queue). Its message is the one of the error, its `error` the error as kept. Its
 * `errno` is `'E_QUEUE_JOB_FAILED'`.
 * @example
 * ```typescript
 * import {type Queue, QueueJobFailedException} from '@lakutata/queue'
 *
 * declare const queue: Queue
 * try {
 *     await queue.request('image.extract', {id: 7})
 * } catch (error) {
 *     if (error instanceof QueueJobFailedException) console.log(error.error.name, error.attempts)
 * }
 * ```
 */
export class QueueJobFailedException extends Exception {
    /**
     * `'E_QUEUE_JOB_FAILED'`.
     */
    public errno: string | number = 'E_QUEUE_JOB_FAILED'

    /**
     * The queue of the message.
     */
    public readonly queue: string

    /**
     * The id of the message.
     */
    public readonly jobId: string

    /**
     * The group whose processing failed.
     */
    public readonly group: string

    /**
     * The attempts made.
     */
    public readonly attempts: number

    /**
     * The last error of the processing.
     */
    public readonly error: QueueJobError

    /**
     * @param details The message, its group, the attempts made and the last error.
     */
    constructor(details: {queue: string, jobId: string, group: string, attempts: number, error: QueueJobError}) {
        super(details.error.message)
        this.queue = details.queue
        this.jobId = details.jobId
        this.group = details.group
        this.attempts = details.attempts
        this.error = details.error
    }
}
