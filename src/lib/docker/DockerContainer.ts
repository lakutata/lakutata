import Dockerode from 'dockerode'
import {As} from '../functions/As.js'
import stream from 'stream'

export class DockerContainer {
    #container: Dockerode.Container

    constructor(container: Dockerode.Container) {
        this.#container = container
    }

    /**
     * Container id
     */
    public get id(): string {
        return this.#container.id
    }

    /**
     * inspect container
     * @param options
     */
    public async inspect(options?: Dockerode.ContainerInspectOptions): Promise<Dockerode.ContainerInspectInfo> {
        return await this.#container.inspect(options ? options : {})
    }

    /**
     * Rename container
     * @param options
     */
    public async rename(options: {}): Promise<void> {
        await this.#container.rename(options ? options : {})
    }

    /**
     * Update container
     * @param options
     */
    public async update(options: {}): Promise<void> {
        await this.#container.update(options ? options : {})
    }

    /**
     * List processes running inside a container
     * @param options
     */
    public async top(options?: { ps_args?: string }): Promise<{
        Titles: string[],
        Processes: string[][]
    }> {
        return await this.#container.top(options ? options : {})
    }

    /**
     * Start container
     * @param options
     */
    public async start(options?: Dockerode.ContainerStartOptions): Promise<void> {
        await this.#container.start(options ? options : {})
    }

    /**
     * Pause container
     */
    public async pause(): Promise<void> {
        await this.#container.pause({})
    }

    /**
     * Unpause container
     */
    public async unpause(): Promise<void> {
        await this.#container.unpause({})
    }

    /**
     * Run a command inside a running container.
     * @param options
     */
    public async exec(options: Dockerode.ExecCreateOptions): Promise<Dockerode.Exec> {
        const exec: Dockerode.Exec = await this.#container.exec(options)
        return exec
    }

    /**
     * Create a new image from a container
     */
    public async commit(): Promise<any> {
        //TODO
        await this.#container.commit({})
    }

    /**
     * Stop container
     * @param options
     */
    public async stop(options?: Dockerode.ContainerStopOptions): Promise<void> {
        await this.#container.stop(options ? options : {})
    }

    /**
     * Restart container
     */
    public async restart(): Promise<void> {
        await this.#container.restart({})
    }

    /**
     * Kill container
     */
    public async kill(): Promise<any> {
        await this.#container.kill({})
    }

    /**
     * Resize the TTY for a container
     * @param options
     */
    public async resize(options: { width: number, height: number }): Promise<void> {
        await this.#container.resize(options)
    }

    /**
     * Block until a container stops, then returns the exit code
     * @param options
     */
    public async wait(options?: Dockerode.ContainerWaitOptions): Promise<void> {
        await this.#container.wait(options ? options : {})
    }

    /**
     * Remove a container
     * @param options
     */
    public async remove(options?: { volumes?: boolean; force?: boolean; link?: boolean }): Promise<void> {
        await this.#container.remove(options ? options : {})
    }

    /**
     * Get container logs
     * @param options
     */
    public async logs(options?: Dockerode.ContainerLogsOptions & { follow: false }): Promise<Buffer>
    /**
     * Get container logs
     * @param options
     */
    public async logs(options?: Dockerode.ContainerLogsOptions & { follow: true }): Promise<NodeJS.ReadableStream>
    public async logs(options?: Dockerode.ContainerLogsOptions & {
        follow: boolean
    }): Promise<Buffer | NodeJS.ReadableStream> {
        return new Promise((resolve, reject) => {
            options = options ? options : {follow: false}
            this.#container.logs(As(options), (error: Error | null, result: any) => {
                if (error) return reject(error)
                return resolve(result)
            })
        })
    }

    /**
     * Get container states
     * @param options
     */
    public async stats(options: { stream: false; 'one-shot'?: boolean }): Promise<Dockerode.ContainerStats>
    /**
     * Get container states
     * @param options
     */
    public async stats(options: { stream: true }): Promise<NodeJS.ReadableStream>
    public async stats(options: {
        stream: boolean;
        'one-shot'?: boolean
    }): Promise<Dockerode.ContainerStats | NodeJS.ReadableStream> {
        return new Promise((resolve, reject) => {
            this.#container.stats(As(options), (error: Error | null, result: any) => {
                if (error) return reject(error)
                return resolve(result)
            })
        })
    }

    /**
     * Attach to container
     * @param options
     */
    public async attach(options: Dockerode.ContainerAttachOptions): Promise<NodeJS.ReadWriteStream> {
        return await this.#container.attach(options)
    }

    /**
     * Start container tty
     * @param options
     */
    public async tty(options: { Cmd: string[] }): Promise<{
        duplex: stream.Duplex
        resize: (size: { width: number; height: number }) => void
    }> {
        const exec = await this.exec({
            AttachStderr: true,
            AttachStdin: true,
            AttachStdout: true,
            Cmd: options.Cmd,
            Tty: true
        })
        const duplex: stream.Duplex = await exec.start({hijack: true})
        return {
            duplex: duplex,
            resize: (size: { width: number; height: number }) => exec.resize({
                w: size.width,
                h: size.height
            })
        }
    }
}
