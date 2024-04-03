import Dockerode from 'dockerode'

export class DockerNetwork {
    #network: Dockerode.Network

    constructor(network: Dockerode.Network) {
        this.#network = network
    }

    /**
     * Network id
     */
    public get id(): string {
        return this.#network.id
    }

    /**
     * Network inspect
     */
    public async inspect(): Promise<Dockerode.NetworkInspectInfo> {
        return await this.#network.inspect()
    }

    /**
     * Remove network
     */
    public async remove(): Promise<void> {
        await this.#network.remove()
    }

    /**
     * Connect a container to a network
     * @param options
     */
    public async connect(options: Dockerode.NetworkConnectOptions): Promise<void> {
        await this.#network.connect(options)
    }

    /**
     * Disconnect a container from a network
     * @param options
     */
    public async disconnect(options: { Container: string; Force: boolean }): Promise<void> {
        await this.#network.disconnect(options)
    }
}
