import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {Duplex, type Readable, type Writable} from 'node:stream'
import type {Message} from '../../client/Protobuf.js'
import type {ContainerStore, ContainerTerminal} from '../../client/ContainerStore.js'
import {ContainerTTYConsoleSizeOptions} from '../options/container/ContainerTTYConsoleSizeOptions.js'
import {ContainerdError} from './ContainerdErrors.js'

/**
 * A terminal of a container: a process executed in it with its pseudo terminal (a shell by default)
 */
@Transient()
export class ContainerdContainerTTY extends Provider {

    @Configurable(DTO.Function())
    protected readonly getStore: () => ContainerStore

    @Configurable(DTO.Function())
    protected readonly getRecord: () => Message

    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)))
    protected readonly cmd: string | string[]

    @Configurable(ContainerTTYConsoleSizeOptions.optional())
    protected readonly initialConsoleSize?: ContainerTTYConsoleSizeOptions

    @Configurable(DTO.Object().optional())
    protected readonly env?: Record<string, string>

    @Configurable(DTO.String().optional())
    protected readonly workingDir?: string

    @Configurable(DTO.String().optional())
    protected readonly user?: string

    #terminal: ContainerTerminal

    #duplexStream: Duplex | undefined

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        try {
            this.#terminal = await this.getStore().terminal(this.getRecord(), {
                cmd: Array.isArray(this.cmd) ? this.cmd : [this.cmd],
                cols: this.initialConsoleSize?.cols,
                rows: this.initialConsoleSize?.rows,
                env: this.env,
                workingDir: this.workingDir,
                user: this.user
            })
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.close()
    }

    /**
     * Get tty duplex stream
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
     * Get tty writable stream
     */
    public get writable(): Writable {
        return this.#terminal.input as Writable
    }

    /**
     * Get tty readable stream
     */
    public get readable(): Readable {
        return this.#terminal.output
    }

    /**
     * Resize tty console size
     * @param options
     */
    @Accept(ContainerTTYConsoleSizeOptions.required())
    public async resize(options: ContainerTTYConsoleSizeOptions): Promise<void> {
        await this.#terminal.resize(options.cols, options.rows)
    }

    /**
     * Set on data handler
     * @param handler
     */
    public onData(handler: (chunk: Buffer) => void): void {
        this.#terminal.output.on('data', handler)
    }

    /**
     * Write data to the terminal
     * @param data
     */
    public write(data: string | Buffer): void {
        this.#terminal.input.write(data)
    }

    /**
     * Wait for the process of the terminal to exit: its exit code
     */
    public async wait(): Promise<number> {
        return await this.#terminal.exited
    }

    /**
     * Close the terminal (its process killed)
     */
    public async close(): Promise<void> {
        await this.#terminal?.close()
    }
}
