import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The size of a container terminal, in characters: its initial size ({@link ContainerCreateTTYOptions.consoleSize}),
 * and its new size given to `DockerContainerTTY.resize()` when the user's terminal is resized. Both are required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * const tty = await container.createTTY({cmd: 'sh', consoleSize: {cols: 120, rows: 40}})
 * //The user's terminal was resized
 * await tty.resize({cols: 160, rows: 50})
 * ```
 */
export class ContainerTTYConsoleSizeOptions extends DTO {

    /**
     * The width, in columns (characters). Required.
     */
    @Expect(DTO.Number().required())
    public cols: number

    /**
     * The height, in rows (lines). Required.
     */
    @Expect(DTO.Number().required())
    public rows: number
}
