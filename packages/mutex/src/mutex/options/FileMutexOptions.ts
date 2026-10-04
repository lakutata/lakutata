import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the file driver ({@link FileMutexDriver}): one lock file per lock in a directory, shared by the
 * processes of one host using the same directory (several workers or applications of a machine). It needs no package.
 * The locks expire after their `ttl` unless renewed, a lock whose process is gone is taken over at once, and there is no
 * fencing token.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Mutex} from 'lakutata/com/mutex'
 *
 * Application.run(() => ({
 *     id: 'file-mutex.app',
 *     name: 'FileMutex',
 *     components: {
 *         //Every worker of this machine uses the same directory
 *         mutex: {class: Mutex, driver: {type: 'file', directory: '/var/lock/my-app'}}
 *     }
 * }))
 * ```
 */
export class FileMutexOptions extends DTO {
    /**
     * The driver type: `'file'`.
     */
    @Expect(DTO.String().valid('file').required())
    public type: 'file'

    /**
     * The directory of the lock files, created when missing. The processes sharing the locks must use the same one; the
     * default depends on the operating system's temporary directory, which can differ between users.
     * @default path.join(os.tmpdir(), 'lakutata-mutex')
     */
    @Expect(DTO.String().optional())
    public directory?: string
}
