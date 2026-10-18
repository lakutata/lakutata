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
 *         //The same as buildQueueOptions(), but at most 100 messages kept for each queue no group consumes yet
 *         queue: buildQueueOptions({driver: {type: 'memory', backlog: 100}})
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

    /**
     * The most messages kept for each queue that no group consumes yet, for its first group: when more arrive, the
     * oldest are dropped. A dead letter queue (`<queue>.dead`) that the application does not consume keeps its last
     * messages only. `0` keeps none, as the server-backed drivers do.
     * @default 1000
     */
    @Expect(DTO.Number().integer().min(0).optional().default(1000))
    public backlog?: number
}
