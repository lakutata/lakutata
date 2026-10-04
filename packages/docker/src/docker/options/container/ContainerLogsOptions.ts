import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * Which logs `DockerContainer.logs()` reads (`docker logs`): a readable stream of the container's standard output and
 * error output, interleaved, as text (the multiplexing of a container without a terminal removed).
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const container = await docker.getContainer('web')
 * //The last 100 lines of the past hour, then the new ones as they are written
 * const logs: NodeJS.ReadableStream = await container.logs({
 *     since: Math.floor(Date.now() / 1000) - 3600,
 *     tail: 100,
 *     timestamps: true
 * })
 * logs.pipe(process.stdout)
 * ```
 */
export class ContainerLogsOptions extends DTO {
    /**
     * Keep the stream open and give the new lines as the container writes them (`docker logs --follow`): the stream
     * ends when the container stops. `false` ends the stream after the existing lines.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public follow?: boolean

    /**
     * Only the lines written from this time on, a UNIX timestamp in seconds; `0` for no lower bound.
     * @default 0
     */
    @Expect(DTO.Number().integer().optional().default(0))
    public since?: number

    /**
     * Only the lines written before this time, a UNIX timestamp in seconds; `0` for no upper bound.
     * @default 0
     */
    @Expect(DTO.Number().integer().optional().default(0))
    public until?: number

    /**
     * Prefix each line with the time it was written, an RFC 3339 date with nanoseconds
     * (`2026-10-04T08:15:30.123456789Z `).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public timestamps?: boolean

    /**
     * Only this number of lines, from the end of the existing logs; all the lines when absent.
     */
    @Expect(DTO.Number().integer().optional())
    public tail?: number

}
