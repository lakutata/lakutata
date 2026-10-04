import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The signal {@link ContainerdContainer.kill} sends to a running container, without waiting for it to exit. Every
 * field is optional. A `SIGKILL` also tells containerd's restart monitor not to restart the container; the other
 * signals do not. Unlike the Docker component's options, the signal may be a number, and all the processes can be
 * signaled.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * //Reload nginx's configuration
 * await container.kill({signal: 'SIGHUP'})
 * ```
 */
export class ContainerKillOptions extends DTO {
    /**
     * The signal: a name (`'SIGTERM'`, `'TERM'`), its number as a string (`'15'`), or a positive integer. An unknown
     * name fails the call.
     * @default 'SIGKILL'
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Number().integer().positive()).optional().default('SIGKILL'))
    public signal?: string | number

    /**
     * Send it to all the container's processes, not only to its main process.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public all?: boolean
}
