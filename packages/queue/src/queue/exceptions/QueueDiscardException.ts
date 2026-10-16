import {Exception} from '@lakutata/core'

/**
 * Thrown by an action to drop the message it processes: the message is acknowledged, neither retried nor sent to the
 * dead letter queue, and its result is not kept. Its `errno` is `'E_QUEUE_DISCARD'`.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {QueueAction, QueueDiscardException} from '@lakutata/queue'
 *
 * class OrderController extends Controller {
 *     @QueueAction('order.notify')
 *     public async notify(input: {id: number, cancelled?: boolean}): Promise<void> {
 *         //Nothing to notify: the message is dropped
 *         if (input.cancelled) throw new QueueDiscardException('The order {id} is cancelled', input)
 *     }
 * }
 * ```
 */
export class QueueDiscardException extends Exception {
    /**
     * `'E_QUEUE_DISCARD'`.
     */
    public errno: string | number = 'E_QUEUE_DISCARD'
}
