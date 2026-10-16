import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the memory driver ({@link MemoryQueueDriver}), the default of a {@link Queue}: the messages are kept in
 * the memory of the process, delivered to the groups of the process, lost when it exits. It needs no package.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildQueueOptions} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'memory-queue.app',
 *     name: 'MemoryQueue',
 *     components: {
 *         //The same as buildQueueOptions()
 *         queue: buildQueueOptions({driver: {type: 'memory'}})
 *     }
 * }))
 * ```
 */
export class MemoryQueueOptions extends DTO {
    /**
     * The driver type: `'memory'`.
     */
    @Expect(DTO.String().valid('memory').required())
    public type: 'memory'
}
