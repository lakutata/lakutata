import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How `DockerContainer.kill()` kills a running container (`docker kill`).
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * //Reload the configuration of the main process
 * await container.kill({signal: 'SIGHUP'})
 * //SIGKILL
 * await container.kill()
 * ```
 */
export class ContainerKillOptions extends DTO {
    /**
     * The signal sent to the container's main process: a name (`'SIGHUP'`, `'SIGTERM'`, also without its `SIG` prefix)
     * or a number (`15`, `'15'`). A signal the daemon does not know is refused by it (`DockerRequestException`,
     * HTTP 400 or 500).
     * @default 'SIGKILL'
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Number().integer().positive()).optional().default('SIGKILL'))
    public signal?: string | number
}
