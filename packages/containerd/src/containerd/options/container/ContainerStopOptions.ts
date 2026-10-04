import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How {@link ContainerdContainer.stop} (and `restart()`) stops a container: its stop signal sent to its main process
 * (a paused container is resumed first), then, after the timeout, `SIGKILL` sent to all its processes; its task is
 * deleted (its exit code kept) and containerd's restart monitor told not to restart it. Every field is optional.
 * Unlike the Docker component's options, the signal may be a number.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('db')
 * //A minute to shut down cleanly
 * await container.stop({signal: 'SIGINT', timeout: 60})
 * ```
 */
export class ContainerStopOptions extends DTO {
    /**
     * The seconds to wait for the container to exit after the signal before killing it, a non-negative integer.
     * @default 10
     */
    @Expect(DTO.Number().integer().min(0).optional().default(10))
    public timeout?: number

    /**
     * The signal sent first: a name (`'SIGTERM'`, `'TERM'`), its number as a string, or a positive integer. By
     * default, the container's stop signal ({@link ContainerCreateOptions.stopSignal}, the image's one), `SIGTERM`
     * without it.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Number().integer().positive()).optional())
    public signal?: string | number
}
