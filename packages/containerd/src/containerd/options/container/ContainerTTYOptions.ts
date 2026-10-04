import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerTTYConsoleSizeOptions} from './ContainerTTYConsoleSizeOptions.js'

/**
 * The process {@link ContainerdContainer.createTTY} runs with a pseudo terminal in a running container (else it throws
 * {@link ContainerdContainerStateException}); the terminal needs `mkfifo` on the host. Every field is optional.
 * Unlike the Docker component's options, the environment, the working directory and the user can be set.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container = await containerd.getContainer('web')
 * const tty = await container.createTTY({cmd: ['/bin/bash', '-l'], consoleSize: {cols: 120, rows: 40}, user: 'www-data'})
 * tty.onData((chunk: Buffer): void => {
 *     process.stdout.write(chunk)
 * })
 * tty.write('ls -la\n')
 * tty.write('exit\n')
 * console.log('Exit code', await tty.wait())
 * ```
 */
export class ContainerTTYOptions extends DTO {
    /**
     * The command: its arguments (`['/bin/bash', '-l']`, at least one), run as they are, or a command line run by
     * `/bin/sh -c` (`'top -d 1'`), as {@link ContainerExecOptions.cmd} is. The default shell is `/bin/sh`, present in
     * every image having a shell (Alpine and BusyBox have no `bash`); an image without a shell (a distroless one) needs
     * an array naming a program of its own.
     * @default ['/bin/sh']
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public cmd?: string | string[]

    /**
     * The initial size of the terminal; the runtime's default when not given.
     */
    @Expect(ContainerTTYConsoleSizeOptions.optional())
    public consoleSize?: ContainerTTYConsoleSizeOptions

    /**
     * Its environment variables, added to the container's ones (and replacing them by name); `TERM` is `xterm` unless
     * given.
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
}
