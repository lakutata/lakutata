import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {QueueDriver} from '../drivers/QueueDriver.js'

/**
 * The options of a driver written by the application (a {@link QueueDriver} subclass), given as an instance. The
 * {@link Queue} connects it when it starts and closes it when it is destroyed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildQueueOptions, MemoryQueueDriver} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'custom-queue.app',
 *     name: 'CustomQueue',
 *     components: {
 *         queue: buildQueueOptions({driver: {type: 'custom', driver: new MemoryQueueDriver()}})
 *     }
 * }))
 * ```
 */
export class CustomQueueOptions extends DTO {
    /**
     * The driver type: `'custom'`.
     */
    @Expect(DTO.String().valid('custom').required())
    public type: 'custom'

    /**
     * The driver.
     */
    @Expect(DTO.Any().custom((value: unknown): QueueDriver => {
        if (!(value instanceof QueueDriver)) throw new TypeError('The driver is not a QueueDriver')
        return value
    }).required())
    public driver: QueueDriver
}
