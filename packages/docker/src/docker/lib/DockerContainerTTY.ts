import {Provider, DTO} from '@lakutata/core'
import {Configurable, Transient} from '@lakutata/core/decorator/di'
import stream from 'stream'
import type {DockerClient} from '../../client/DockerClient.js'
import {ContainerTTYConsoleSizeOptions} from '../options/container/ContainerTTYConsoleSizeOptions.js'
import {Accept} from '@lakutata/core/decorator/dto'
import {type Logger} from '@lakutata/logger'
import {type IdResponse} from '../../client/types/IdResponse.js'

/**
 * An interactive command running with a TTY in a container, as `docker exec -it`: what is written to it is the
 * command's input, its output (stdout and stderr together, with the terminal's control sequences) is read from it. It is
 * not created with `new`: {@link DockerContainer.createTTY} returns it, its command started.
 *
 * The command runs until it exits (`exit` written to a shell), or until the stream is closed (`tty.raw.end()`,
 * `tty.raw.destroy()`); the stream then ends. A command which cannot be started (not found in the image) does not fail
 * the creation: its error message is the output, then the stream ends. The write failures are logged by the
 * application's `log` component, else by the console.
 * @example
 * ```typescript
 * import {type DockerContainer, type DockerContainerTTY} from 'lakutata/com/docker'
 *
 * declare const container: DockerContainer
 *
 * //A shell: /bin/sh by default
 * const tty: DockerContainerTTY = await container.createTTY({consoleSize: {cols: 120, rows: 40}})
 * tty.onData((chunk: Buffer): void => {
 *     process.stdout.write(chunk)
 * })
 * tty.raw.once('end', (): void => console.log('The shell exited'))
 * tty.write('ls -l /\n')
 * await tty.resize({cols: 160, rows: 50})
 * tty.write('exit\n')
 * ```
 */
@Transient()
export class DockerContainerTTY extends Provider {

    /**
     * Give the client of the Engine API: set by the {@link DockerContainer} creating the object.
     */
    @Configurable(DTO.Function())
    protected readonly getClient: () => DockerClient

    /**
     * The full ID of the container running the command.
     */
    @Configurable(DTO.String())
    protected readonly containerId: string

    /**
     * The command run: the program and its arguments (a program name alone as a string).
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)))
    protected readonly cmd: string | string[]

    /**
     * The size of the console when the command starts.
     * @default undefined (chosen by the daemon)
     */
    @Configurable(ContainerTTYConsoleSizeOptions.optional())
    protected readonly initialConsoleSize?: ContainerTTYConsoleSizeOptions

    #execId: string

    #duplexStream: stream.Duplex

    /**
     * The logger of the write failures: the application's log component, else the console
     */
    #log: Pick<Logger, 'warn'>

    /**
     * Create the execution of the command and start it, attached to its TTY.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When the container is not running (HTTP 409).
     * @protected
     */
    protected async init(): Promise<void> {
        try {
            this.#log = await this.getObject<Logger>('log')
        } catch {
            //An application without a log component
            this.#log = console
        }
        const exec: IdResponse = await this.getClient().createExec(this.containerId, {
            AttachStderr: true,
            AttachStdin: true,
            AttachStdout: true,
            Cmd: this.cmd ? Array.isArray(this.cmd) ? this.cmd : [this.cmd] : undefined,
            Tty: true,
            ConsoleSize: [this.initialConsoleSize?.rows ? this.initialConsoleSize.rows : 0, this.initialConsoleSize?.cols ? this.initialConsoleSize.cols : 0]
        })
        this.#execId = exec.Id
        //Started with its TTY: its output is not multiplexed
        this.#duplexStream = await this.getClient().startExec(this.#execId, {Detach: false, Tty: true})
    }

    /**
     * Close the stream of the TTY, which ends the command's input.
     * @protected
     */
    protected async destroy(): Promise<void> {
        //Not created when its execution failed to start
        if (this.#duplexStream && !this.#duplexStream.destroyed) {
            this.#duplexStream.removeAllListeners()
            this.#duplexStream.destroy()
        }
    }

    /**
     * The stream of the TTY, both ways: written, the command's input; read, its output. Its `end` event tells that the
     * command exited, once its output is read (with {@link DockerContainerTTY.onData} or a `data` listener).
     */
    public get raw(): stream.Duplex {
        return this.#duplexStream
    }

    /**
     * The stream of the TTY, typed as its writable side: the command's input.
     */
    public get writable(): stream.Writable {
        return this.#duplexStream
    }

    /**
     * The stream of the TTY, typed as its readable side: the command's output.
     */
    public get readable(): stream.Readable {
        return this.#duplexStream
    }

    /**
     * Change the size of the TTY's console, as a terminal window resized does (the command gets `SIGWINCH`).
     * @param options The number of columns (`cols`) and rows (`rows`).
     * @throws {DockerRequestException} When the command has exited (HTTP 404, no such exec; HTTP 500).
     * @throws {DockerContainerNotFoundException} When the container was removed.
     */
    @Accept(ContainerTTYConsoleSizeOptions.required())
    public async resize(options: ContainerTTYConsoleSizeOptions): Promise<void> {
        await this.getClient().resizeExec(this.#execId, {
            w: options.cols,
            h: options.rows
        })
    }

    /**
     * Receive the command's output as it comes. Each call adds a handler.
     * @param handler Called with each chunk of the output: raw bytes, the terminal's control sequences included.
     */
    public onData(handler: (chunk: Buffer) => void): void {
        this.#duplexStream.on('data', handler)
    }

    /**
     * Write text to the command's input, as typed on its terminal (`'ls\n'` runs `ls` in a shell). A write failure is
     * not thrown: it is logged as a warning by the `log` component (by the console without it).
     * @param data The text written, UTF-8 encoded.
     */
    public write(data: string): void
    /**
     * Write bytes to the command's input, as typed on its terminal. A write failure is not thrown: it is logged as a
     * warning by the `log` component (by the console without it).
     * @param data The bytes written.
     */
    public write(data: Buffer): void
    public write(data: string | Buffer): void {
        this.#duplexStream.write(data, (error: Error | null | undefined): void => {
            if (error) this.#log.warn('Write data to duplex stream error: %s', error.message)
        })
    }
}
