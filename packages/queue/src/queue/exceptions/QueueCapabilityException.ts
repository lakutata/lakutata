import {Exception} from '@lakutata/core'

/**
 * Thrown when a queue option needs what the driver of the {@link Queue} does not support: `priority`, `dedupe` or a
 * `delay` on a driver without them (when the queue cannot emulate it), an `ordered` action on a driver without the
 * ordering by key, `request()` or `result()` without the reply channel nor a result store. Its `errno` is
 * `'E_QUEUE_CAPABILITY'`.
 */
export class QueueCapabilityException extends Exception {
    /**
     * `'E_QUEUE_CAPABILITY'`.
     */
    public errno: string | number = 'E_QUEUE_CAPABILITY'
}
