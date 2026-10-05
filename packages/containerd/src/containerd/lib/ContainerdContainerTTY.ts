import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {Duplex, type Readable, type Writable} from 'node:stream'
import {type Message} from '@lakutata/grpc'
import type {ContainerStore, ContainerTerminal} from '../../client/ContainerStore.js'
import {ContainerTTYConsoleSizeOptions} from '../options/container/ContainerTTYConsoleSizeOptions.js'
import {containerdError} from './ContainerdErrors.js'

/**
 * An interactive terminal in a running container: a process (a shell by default) run with a pseudo terminal, as
 * `docker exec -it` does. Get it from {@link ContainerdContainer.createTTY}; do not create it yourself. Write its input
 * with {@link ContainerdContainerTTY.write} (or {@link ContainerdContainerTTY.writable}), read its output with
 * {@link ContainerdContainerTTY.onData} (or {@link ContainerdContainerTTY.readable}), or pipe a socket into
 * {@link ContainerdContainerTTY.raw}. The terminal ends when its process exits or when it is closed; it is closed when
 * the object is destroyed.
 * @example
 * ```typescript
 * import {type Containerd, type ContainerdContainer, type ContainerdContainerTTY} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container: ContainerdContainer = await containerd.getContainer('worker')
 * const tty: ContainerdContainerTTY = await container.createTTY({cmd: ['/bin/sh', '-l'], consoleSize: {cols: 120, rows: 40}})
 * tty.onData((chunk: Buffer): void => {
 *     process.stdout.write(chunk)
 * })
 * tty.write('ls -la\n')
 * await tty.resize({cols: 100, rows: 30})
 * tty.write('exit\n')
 * //The exit code of the shell
 * console.log(await tty.wait())
 * ```
 */
@Transient()
export class ContainerdContainerTTY extends Provider {

    /**
     * Gives the component's container store; set by the container.
     */
    @Configurable(DTO.Function())
    protected readonly getStore: () => ContainerStore

    /**
     * Gives the container's record in containerd; set by the container.
     */
    @Configurable(DTO.Function())
    protected readonly getRecord: () => Message

    /**
     * The command run in the terminal: a command line run by `/bin/sh -c`, or an executable and its arguments.
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)))
    protected readonly cmd: string | string[]

    /**
     * The console size the terminal starts with, in columns and rows.
     * @default the runtime's default size
     */
    @Configurable(ContainerTTYConsoleSizeOptions.optional())
    protected readonly initialConsoleSize?: ContainerTTYConsoleSizeOptions

    /**
     * The environment variables added to the container's (`TERM` is `xterm` unless given).
     * @default none
     */
    @Configurable(DTO.Object().optional())
    protected readonly env?: Record<string, string>

    /**
     * The working directory of the process.
     * @default the container's working directory
     */
    @Configurable(DTO.String().optional())
    protected readonly workingDir?: string

    /**
     * The user running the process (`name`, `uid`, `name:group`), looked up in the container's `/etc/passwd`.
     * @default the container's user
     */
    @Configurable(DTO.String().optional())
    protected readonly user?: string

    #terminal: ContainerTerminal

    #duplexStream: Duplex | undefined

    /**
     * Start the terminal's process in the container.
     * @throws {ContainerdContainerStateException} The container is not running.
     * @throws {Error} The host has no `mkfifo`; the user is not found in the container.
     * @protected
     */
    protected async init(): Promise<void> {
        try {
            this.#terminal = await this.getStore().terminal(this.getRecord(), {
                cmd: Array.isArray(this.cmd) ? this.cmd : ['/bin/sh', '-c', this.cmd],
                cols: this.initialConsoleSize?.cols,
                rows: this.initialConsoleSize?.rows,
                env: this.env,
                workingDir: this.workingDir,
                user: this.user
            })
        } catch (error: unknown) {
            throw containerdError(error)
        }
    }

    /**
     * Close the terminal, as {@link ContainerdContainerTTY.close} does.
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.close()
    }

    /**
     * The terminal as one duplex stream: writing sends input to the process, reading gives its output (to pipe a
     * WebSocket or a socket into it). It is created at the first access and consumes the output from then on.
     */
    public get raw(): Duplex {
        //Created once asked: it reads the output (which onData would not have otherwise)
        if (!this.#duplexStream) {
            this.#duplexStream = Duplex.from({readable: this.#terminal.output, writable: this.#terminal.input as Writable})
            this.#duplexStream.on('error', (): void => undefined)
        }
        return this.#duplexStream
    }

    /**
     * The terminal's input: what is written is sent to the process, as typed on a keyboard (`\x03` for Ctrl+C).
     */
    public get writable(): Writable {
        return this.#terminal.input as Writable
    }

    /**
     * The terminal's output: what the process prints, its standard error included; it ends when the process exits.
     */
    public get readable(): Readable {
        return this.#terminal.output
    }

    /**
     * Resize the terminal's console; the process receives `SIGWINCH`.
     * @param options The new size, in columns and rows (positive integers).
     * @throws {GRPCError} The process has exited (from `@lakutata/grpc`).
     */
    @Accept(ContainerTTYConsoleSizeOptions.required())
    public async resize(options: ContainerTTYConsoleSizeOptions): Promise<void> {
        await this.#terminal.resize(options.cols, options.rows)
    }

    /**
     * Listen to the terminal's output. Each call adds a listener.
     * @param handler Called with each chunk of output.
     */
    public onData(handler: (chunk: Buffer) => void): void {
        this.#terminal.output.on('data', handler)
    }

    /**
     * Send input to the terminal's process.
     * @param data The input, as text or bytes (`'ls\n'`, a newline to submit a line).
     */
    public write(data: string | Buffer): void {
        this.#terminal.input.write(data)
    }

    /**
     * Wait for the terminal's process to exit; the terminal is then closed.
     * @returns Its exit code (`137` when it was closed by {@link ContainerdContainerTTY.close}).
     */
    public async wait(): Promise<number> {
        return await this.#terminal.exited
    }

    /**
     * Close the terminal: kill its process with `SIGKILL` and release its FIFOs. Nothing happens when it is already
     * closed.
     */
    public async close(): Promise<void> {
        await this.#terminal?.close()
    }
}
