import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the file store: the entries are kept in memory and saved to one JSON file (loaded when the cache
 * starts, written in batches, flushed when the cache is destroyed), so they survive a restart. It needs no optional
 * dependency.
 *
 * The file is rewritten whole on each save (through a temporary file renamed over it), so it suits small caches;
 * the processes sharing one file overwrite each other's entries. An unreadable file (not JSON) fails the cache's
 * creation; a failed save is emitted as an `'error'` event of the cache. The values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'file-cache.app',
 *     name: 'FileCache',
 *     components: {
 *         cache: buildCacherOptions({
 *             stores: {type: 'file', filename: './cache/data.json', namespace: 'app', writeDelay: 500},
 *             ttl: 3600000
 *         })
 *     }
 * }))
 * ```
 */
export class FileCacheOptions extends DTO {
    /**
     * The store type: `'file'`.
     */
    @Expect(DTO.String().allow('file').only().required())
    public type: 'file'

    /**
     * The path of the file, relative to the working directory; created (with its directories) at the first save.
     */
    @Expect(DTO.String().required())
    public filename: string

    /**
     * The minimum interval, in milliseconds, between two purges of the expired entries from the file (done at a save).
     * An expired entry is a miss anyway, and is removed when read.
     * @default 3600000
     */
    @Expect(DTO.Number().positive().optional().default(3600 * 1000))
    public expiredCheckDelay?: number

    /**
     * The delay, in milliseconds, between a change and the save of the file: the changes made meanwhile are saved
     * together. `0` saves at the next turn of the event loop.
     * @default 100
     */
    @Expect(DTO.Number().positive().allow(0).optional().default(100))
    public writeDelay?: number

    /**
     * The namespace of the entries: the keys are saved as `{namespace}:{key}`, and `clear()` deletes only the
     * namespace's entries. Without it, `clear()` deletes all the file's entries.
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}