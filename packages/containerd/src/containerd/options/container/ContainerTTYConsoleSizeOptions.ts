import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The size of a container terminal, in characters: the initial one ({@link ContainerTTYOptions.consoleSize}), or the
 * new one given to {@link ContainerdContainerTTY.resize}. Both fields are required.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * const tty = await container.createTTY({consoleSize: {cols: 80, rows: 24}})
 * //The user's window was resized
 * await tty.resize({cols: 120, rows: 40})
 * ```
 */
export class ContainerTTYConsoleSizeOptions extends DTO {

    /**
     * The width in columns, a positive integer.
     */
    @Expect(DTO.Number().integer().positive().required())
    public cols: number

    /**
     * The height in rows, a positive integer.
     */
    @Expect(DTO.Number().integer().positive().required())
    public rows: number
}
