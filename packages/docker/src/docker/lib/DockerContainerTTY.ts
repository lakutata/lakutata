import {Provider, DTO} from '@lakutata/core'
import {Configurable, Transient, Inject} from '@lakutata/core/decorator/di'
import stream from 'stream'
import type {DockerClient} from '../../client/DockerClient.js'
import {ContainerTTYConsoleSizeOptions} from '../options/container/ContainerTTYConsoleSizeOptions.js'
import {Accept} from '@lakutata/core/decorator/dto'
import {Logger} from '@lakutata/logger'
import {type IdResponse} from '../../client/types/IdResponse.js'

@Transient()
export class DockerContainerTTY extends Provider {

    @Inject('log')
    protected readonly log: Logger

    @Configurable(DTO.Function())
    protected readonly getClient: () => DockerClient

    @Configurable(DTO.String())
    protected readonly containerId: string

    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)))
    protected readonly cmd: string | string[]

    @Configurable(ContainerTTYConsoleSizeOptions.optional())
    protected readonly initialConsoleSize?: ContainerTTYConsoleSizeOptions

    #execId: string

    #duplexStream: stream.Duplex

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
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
     * Destroyer
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
     * Get tty duplex stream
     */
    public get raw(): stream.Duplex {
        return this.#duplexStream
    }

    /**
     * Get tty writable stream
     */
    public get writable(): stream.Writable {
        return this.#duplexStream
    }

    /**
     * Get tty readable stream
     */
    public get readable(): stream.Readable {
        return this.#duplexStream
    }

    /**
     * Resize tty console size
     * @param options
     */
    @Accept(ContainerTTYConsoleSizeOptions.required())
    public async resize(options: ContainerTTYConsoleSizeOptions): Promise<void> {
        await this.getClient().resizeExec(this.#execId, {
            w: options.cols,
            h: options.rows
        })
    }

    /**
     * Set on data handler
     * @param handler
     */
    public onData(handler: (chunk: Buffer) => void): void {
        this.#duplexStream.on('data', handler)
    }

    /**
     * Write data to duplex stream
     * @param data
     */
    public write(data: string): void
    /**
     * Write data to duplex stream
     * @param data
     */
    public write(data: Buffer): void
    public write(data: string | Buffer): void {
        this.#duplexStream.write(data, (error: Error | null | undefined): void => {
            if (error) this.log.warn('Write data to duplex stream error: %s', error.message)
        })
    }
}
