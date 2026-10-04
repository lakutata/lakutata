import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * How {@link ContainerdContainer.logs} reads a container's logs: the file its containerd shim writes its standard
 * output and error to, interleaved and raw (no timestamps, no stream prefix), with its previous rotated file (the
 * component's `logMaxSize` option). Every field is optional. Unlike the Docker component's options, there is no
 * `since`, `until` nor `timestamps`.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * //The last 100 lines, then the new ones while it runs
 * const logs = await container.logs({tail: 100})
 * logs.on('data', (chunk: Buffer): void => {
 *     process.stdout.write(chunk)
 * })
 * ```
 */
export class ContainerLogsOptions extends DTO {
    /**
     * Keep the stream open and send the new output while the container runs (polled every 250 milliseconds); it ends
     * once the container stops without its restart monitor restarting it. Without it, the stream ends after the
     * existing logs.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public follow?: boolean

    /**
     * The number of lines read from the end of the existing logs, a non-negative integer (`0`: none of them); all of
     * them by default.
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public tail?: number
}
