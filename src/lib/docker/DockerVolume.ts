import Dockerode from 'dockerode'

export class DockerVolume {
    #volume: Dockerode.Volume

    constructor(volume: Dockerode.Volume) {
        this.#volume = volume
    }

    /**
     * Volume name
     */
    public get name(): string {
        return this.#volume.name
    }

    /**
     * Inspect volume
     */
    public async inspect(): Promise<Dockerode.VolumeInspectInfo> {
        return await this.#volume.inspect({})
    }

    /**
     * Remove volume
     * @param options
     */
    public async remove(options?: Dockerode.VolumeRemoveOptions): Promise<void> {
        await this.#volume.remove(options ? options : {})
    }
}
