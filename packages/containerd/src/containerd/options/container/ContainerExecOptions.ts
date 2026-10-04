import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * A command {@link ContainerdContainer.exec} runs in a running container (else it throws
 * {@link ContainerdContainerStateException}), waiting for its exit and capturing its output in memory. Only `cmd` is
 * required; the process gets the container's settings (environment, user, capabilities) unless changed here.
 * Separating its standard error and giving it a standard input use FIFOs (`mkfifo` on the host). Unlike the Docker
 * component's options, a string `cmd` is run by a shell, the process can get an environment, a user, a standard input
 * and a timeout, and the result holds the exit code and the two outputs apart.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('db')
 * const result = await container.exec({
 *     cmd: ['psql', '-U', 'postgres', '-f', '-'],
 *     stdin: 'SELECT 1;',
 *     timeout: 30000
 * })
 * if (result.exitCode !== 0) console.error(result.stderr)
 * ```
 */
export class ContainerExecOptions extends DTO {
    /**
     * The command: its arguments (`['ls', '-la', '/data']`, at least one), or a command line run by `/bin/sh -c`
     * (`'ls -la /data | wc -l'`), which needs a shell in the container. Required.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).required())
    public cmd: string | string[]

    /**
     * Its environment variables, added to the container's ones (and replacing them by name).
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public env?: Record<string, string>

    /**
     * Its working directory; the container's one by default.
     */
    @Expect(DTO.String().optional())
    public workingDir?: string

    /**
     * Its user: `'user'`, `'user:group'`, `'uid'` or `'uid:gid'`, the names resolved by the container's `/etc/passwd`
     * and `/etc/group`; the container's user by default.
     */
    @Expect(DTO.String().optional())
    public user?: string

    /**
     * The data written to its standard input, which is closed after it. Without it, the process has no standard input.
     * Needs `mkfifo` on the host.
     */
    @Expect(DTO.Alternatives(DTO.String().allow(''), DTO.Binary()).optional())
    public stdin?: string | Buffer

    /**
     * The milliseconds it may run, a positive integer: it is then killed (`SIGKILL`) and the result has its exit code
     * (`137`) and its output so far. No limit by default.
     */
    @Expect(DTO.Number().integer().positive().optional())
    public timeout?: number
}
