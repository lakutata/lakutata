import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the memory driver ({@link MemoryMutexDriver}), the default of a {@link Mutex}: the locks live in the
 * process memory, shared by the components of the process and invisible to the other processes. For development, tests
 * and an application running as a single process; it needs no package. The locks expire after their `ttl` unless
 * renewed, and carry fencing tokens counted by the process.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Mutex} from 'lakutata/com/mutex'
 *
 * Application.run(() => ({
 *     id: 'memory-mutex.app',
 *     name: 'MemoryMutex',
 *     components: {
 *         //The same as {class: Mutex}
 *         mutex: {class: Mutex, driver: {type: 'memory'}}
 *     }
 * }))
 * ```
 */
export class MemoryMutexOptions extends DTO {
    /**
     * The driver type: `'memory'`.
     */
    @Expect(DTO.String().valid('memory').required())
    public type: 'memory'
}
