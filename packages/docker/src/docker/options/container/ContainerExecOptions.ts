import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The command `DockerContainer.exec()` runs in a running container, without a terminal nor an input (`docker exec`); it
 * resolves once the command exits, with its exit code and its standard output and error output apart.
 * @example
 * ```typescript
 * import {Docker, type ContainerExecResult} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * const listing: ContainerExecResult = await container.exec({cmd: ['ls', '-la', '/app']})
 * //A command line, run by /bin/sh -c
 * const count: ContainerExecResult = await container.exec({cmd: 'ls /app | wc -l'})
 * if (count.exitCode !== 0) console.error(count.stderr)
 * console.log(listing.stdout, count.stdout)
 * ```
 */
export class ContainerExecOptions extends DTO {
    /**
     * The command: the executable followed by its arguments (`['ls', '-la', '/app']`, at least one item), run as they
     * are; or a command line (`'ls /app | wc -l'`), run by `/bin/sh -c`, which needs a shell in the container.
     * Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).required())
    public cmd: string | string[]
}
