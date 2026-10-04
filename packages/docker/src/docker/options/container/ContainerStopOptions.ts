import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How `DockerContainer.stop()` and `DockerContainer.restart()` stop a running container (`docker stop`): Docker sends
 * the stop signal to its main process, then kills it with `SIGKILL` when it has not exited after the timeout.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * //Up to 30 seconds to finish the requests in progress
 * await container.stop({signal: 'SIGINT', timeout: 30})
 * await container.restart({timeout: 5})
 * ```
 */
export class ContainerStopOptions extends DTO {
    /**
     * The signal sent first, a name (`'SIGINT'`) or a number (`'2'`); the container's stop signal when absent (its
     * image's `STOPSIGNAL`, `SIGTERM` by default).
     */
    @Expect(DTO.String().optional())
    public signal?: string

    /**
     * The time given to the container to exit before it is killed, in seconds (a whole number); the container's stop
     * timeout when absent, 10 seconds by default.
     */
    @Expect(DTO.Number().optional())
    public timeout?: number
}
