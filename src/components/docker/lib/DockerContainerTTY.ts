import {Provider} from '../../../lib/core/Provider.js'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/core/DTO.js'
import Dockerode from 'dockerode'
import stream from 'stream'
import {Transient} from '../../../decorators/di/Lifetime.js'
import {ContainerTTYConsoleSizeOptions} from '../options/container/ContainerTTYConsoleSizeOptions.js'
import {Accept} from '../../../decorators/dto/Accept.js'
import {As} from '../../../lib/functions/As.js'
import {Logger} from '../../Logger.js'
import {Inject} from '../../../decorators/di/Inject.js'

@Transient()
export class DockerContainerTTY extends Provider {

    @Inject('log')
    protected readonly log: Logger

    @Configurable(DTO.InstanceOf(Dockerode.Container))
    protected readonly container: Dockerode.Container

    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)))
    protected readonly cmd: string | string[]

    @Configurable(ContainerTTYConsoleSizeOptions.optional())
    protected readonly initialConsoleSize?: ContainerTTYConsoleSizeOptions

    #exec: Dockerode.Exec

    #duplexStream: stream.Duplex

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#exec = await this.container.exec(As({
            AttachStderr: true,
            AttachStdin: true,
            AttachStdout: true,
            Cmd: this.cmd ? Array.isArray(this.cmd) ? this.cmd : [this.cmd] : undefined,
            Tty: true,
            ConsoleSize: [this.initialConsoleSize?.rows ? this.initialConsoleSize.rows : 0, this.initialConsoleSize?.cols ? this.initialConsoleSize.cols : 0]
        }))
        this.#duplexStream = await this.#exec.start({hijack: true})
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        if (!this.#duplexStream.destroyed) {
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
        await this.#exec.resize({
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
