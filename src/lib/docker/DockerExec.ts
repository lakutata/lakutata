import Dockerode from 'dockerode'
import stream from 'stream'

export class DockerExec {
    #exec: Dockerode.Exec

    constructor(exec: Dockerode.Exec) {
        this.#exec = exec
    }

    /**
     * Exec id
     */
    public get id(): string {
        return this.#exec.id
    }

    /**
     * Inspect exec
     * @param options
     */
    public async inspect(options?: Dockerode.ExecInspectOptions): Promise<Dockerode.ExecInspectInfo> {
        return await this.#exec.inspect(options ? options : {})
    }

    /**
     * Start exec
     * @param options
     */
    public async start(options: Dockerode.ExecStartOptions): Promise<stream.Duplex> {
        return await this.#exec.start(options)
    }

    /**
     * Resize exec tty size
     * @param options
     */
    public async resize(options: { w: number; h: number }): Promise<void> {
        await this.#exec.resize(options)
    }
}
