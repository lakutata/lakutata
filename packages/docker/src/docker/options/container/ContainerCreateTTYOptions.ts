import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerTTYConsoleSizeOptions} from './ContainerTTYConsoleSizeOptions.js'

/**
 * The interactive command `DockerContainer.createTTY()` runs in a running container with a terminal (`docker exec -it`),
 * read and written through the returned `DockerContainerTTY`.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * const tty = await container.createTTY({cmd: ['/bin/bash', '-l'], consoleSize: {cols: 120, rows: 40}})
 * tty.onData((chunk: Buffer): void => {
 *     process.stdout.write(chunk)
 * })
 * tty.write('ls -la\n')
 * ```
 */
export class ContainerCreateTTYOptions extends DTO {
    /**
     * The command: the executable followed by its arguments (`['/bin/bash', '-l']`, at least one item), run as they
     * are; or a command line (`'top -d 1'`), run by `/bin/sh -c`. The default needs a shell in the image (not in the
     * distroless ones).
     * @default ['/bin/sh']
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public cmd?: string | string[]

    /**
     * The terminal's initial size; without it, Docker's default size, until `DockerContainerTTY.resize()` is called.
     */
    @Expect(ContainerTTYConsoleSizeOptions.optional())
    public consoleSize?: ContainerTTYConsoleSizeOptions
}
