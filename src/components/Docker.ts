import {Component} from '../lib/core/Component.js'
import Dockerode, {DockerVersion} from 'dockerode'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {Singleton} from '../decorators/di/Lifetime.js'
import {Exception} from '../lib/base/abstracts/Exception.js'
import {As} from '../lib/functions/As.js'
import {DockerContainer} from '../lib/docker/DockerContainer.js'
import {DockerImage} from '../lib/docker/DockerImage.js'
import {DockerVolume} from '../lib/docker/DockerVolume.js'
import {DockerNetwork} from '../lib/docker/DockerNetwork.js'
import {createInterface} from 'node:readline'
import {IncomingMessage} from 'node:http'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'stream/promises'

/**
 * Docker connection key object
 */
export interface KeyObject {
    pem: string | Buffer;
    passphrase?: string | undefined;
}

/**
 * Docker connection options
 */
export interface DockerConnectionOptions {
    socketPath?: string | undefined;
    host?: string | undefined;
    port?: number | string | undefined;
    username?: string | undefined;
    headers?: { [name: string]: string };
    ca?: string | string[] | Buffer | Buffer[] | undefined;
    cert?: string | string[] | Buffer | Buffer[] | undefined;
    key?: string | string[] | Buffer | Buffer[] | KeyObject[] | undefined;
    protocol?: 'https' | 'http' | 'ssh' | undefined;
    timeout?: number | undefined;
    version?: string | undefined;
    sshAuthAgent?: string | undefined;
}

/**
 * Docker socket connection options
 */
export interface DockerSocketConnectionOptions extends Omit<DockerConnectionOptions, 'sshAuthAgent' | 'key' | 'protocol' | 'cert' | 'headers' | 'username' | 'port' | 'host'> {
}

/**
 * Docker http connection options
 */
export interface DockerHttpConnectionOptions extends Omit<DockerConnectionOptions, 'socketPath' | 'sshAuthAgent'> {
    host: string
    port: number | string
}

/**
 * Docker https connection options
 */
export interface DockerHttpsConnectionOptions extends Omit<DockerConnectionOptions, 'socketPath' | 'sshAuthAgent'> {
    host: string
    port: number | string
}

/**
 * Docker ssh connection options
 */
export interface DockerSSHConnectionOptions extends Omit<DockerConnectionOptions, 'socketPath'> {
    host: string
    port: number | string
}

/**
 * Build docker config
 * @param options
 * @constructor
 */
export const BuildDockerConnectionConfig: (options: DockerConnectionOptions) => DockerConnectionOptions = (options: DockerConnectionOptions) => ({
    ...options,
    class: Docker
})
/**
 * Build docker socket config
 * @param options
 * @constructor
 */
export const BuildDockerSocketConnectionConfig: (options: DockerSocketConnectionOptions) => DockerConnectionOptions = (options: DockerSocketConnectionOptions) => ({
    ...options,
    class: Docker
})

/**
 * Build docker http config
 * @param options
 * @constructor
 */
export const BuildDockerHttpConnectionConfig: (options: DockerHttpConnectionOptions) => DockerConnectionOptions = (options: DockerHttpConnectionOptions) => ({
    ...options,
    protocol: 'http',
    class: Docker
})
/**
 * Build docker https config
 * @param options
 * @constructor
 */
export const BuildDockerHttpsConnectionConfig: (options: DockerHttpsConnectionOptions) => DockerConnectionOptions = (options: DockerHttpsConnectionOptions) => ({
    ...options,
    protocol: 'https',
    class: Docker
})
/**
 * Build docker ssh config
 * @param options
 * @constructor
 */
export const BuildDockerSSHConnectionConfig: (options: DockerSSHConnectionOptions) => DockerConnectionOptions = (options: DockerSSHConnectionOptions) => ({
    ...options,
    protocol: 'ssh',
    class: Docker
})

/**
 * Docker connection exception
 */
export class DockerConnectionException extends Exception {
    public errno: string | number = 'E_DOCKER_CONNECTION'
}

@Singleton()
export class Docker extends Component implements DockerConnectionOptions {

    @Configurable(DTO.String().optional())
    public readonly socketPath?: string | undefined

    @Configurable(DTO.String().optional())
    public readonly host?: string | undefined

    @Configurable(DTO.Alternatives(
        DTO.Number().port(),
        DTO.String()
    ).optional())
    public readonly port?: number | string | undefined

    @Configurable(DTO.String().optional())
    public readonly username?: string | undefined

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    public readonly headers?: { [name: string]: string }

    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary())
    ).optional())
    public readonly ca?: string | string[] | Buffer | Buffer[] | undefined

    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary())
    ).optional())
    public readonly cert?: string | string[] | Buffer | Buffer[] | undefined

    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary()),
        DTO.Array(DTO.Object({
            pem: DTO.Alternatives(DTO.String(), DTO.Binary()).required(),
            passphrase: DTO.String().optional()
        }))
    ).optional())
    public readonly key?: string | string[] | Buffer | Buffer[] | KeyObject[] | undefined

    @Configurable(DTO.String().valid('https', 'http', 'ssh').optional())
    public readonly protocol?: 'https' | 'http' | 'ssh' | undefined

    @Configurable(DTO.Number().optional())
    public readonly timeout?: number | undefined

    @Configurable(DTO.String().optional())
    public readonly version?: string | undefined

    @Configurable(DTO.String().optional())
    public readonly sshAuthAgent?: string | undefined

    #dockerVersion: DockerVersion

    #instance: Dockerode

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        if (!this.socketPath && !this.host) throw new DockerConnectionException('Docker connection target not set')
        try {
            this.#instance = new Dockerode(this)
            this.#dockerVersion = await this.#instance.version()
        } catch (error: any) {
            throw new DockerConnectionException(error)
        }
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#instance = As(null)
    }

    /**
     * Create docker container
     * @param options
     */
    public async createContainer(options: Dockerode.ContainerCreateOptions): Promise<DockerContainer> {
        return await this.#instance.createContainer(options)
    }

    /**
     * Load docker image
     * @param file
     * @param options
     */
    public async importImage(file: string | NodeJS.ReadableStream, options?: {}): Promise<NodeJS.ReadableStream> {
        return await this.#instance.loadImage(file, options ? options : {})
    }

    /**
     * Build docker image
     * @param context
     * @param options
     */
    //TODO 将context修改一下变得更易用
    public async buildImage(context: Dockerode.ImageBuildContext, options?: Dockerode.ImageBuildOptions): Promise<NodeJS.ReadableStream> {
        return await this.#instance.buildImage(context, options ? options : {})
    }

    /**
     * Export docker image
     * @param image
     * @param writeStream
     */
    public async exportImage(image: string, writeStream: NodeJS.WritableStream): Promise<void>
    /**
     * Export docker image
     * @param image
     * @param filename
     */
    public async exportImage(image: string, filename: string): Promise<void>
    public async exportImage(image: string, filenameOrWriteStream: string | NodeJS.WritableStream): Promise<void> {
        const readableStream: NodeJS.ReadableStream = await this.getImage(image).get()
        const destStream: NodeJS.WritableStream = typeof filenameOrWriteStream === 'string'
            ? createWriteStream(filenameOrWriteStream)
            : filenameOrWriteStream
        await pipeline(readableStream, destStream)
    }

    /**
     * List docker containers
     * @param options
     */
    public async listContainers(options?: Dockerode.ContainerListOptions): Promise<Dockerode.ContainerInfo[]> {
        return await this.#instance.listContainers(options ? options : {})
    }

    /**
     * List docker images
     * @param options
     */
    public async listImages(options?: Dockerode.ListImagesOptions): Promise<Dockerode.ImageInfo[]> {
        return await this.#instance.listImages(options ? options : {})
    }

    /**
     * List docker volumes
     * @param options
     */
    public async listVolumes(options?: Dockerode.VolumeListOptions): Promise<{
        Volumes: Dockerode.VolumeInspectInfo[];
        Warnings: string[];
    }> {
        return await this.#instance.listVolumes(options ? options : {})
    }

    /**
     * List docker networks
     * @param options
     */
    public async listNetworks(options?: Dockerode.NetworkListOptions): Promise<Dockerode.NetworkInspectInfo[]> {
        return await this.#instance.listNetworks(options ? options : {})
    }

    /**
     * Create docker volume
     * @param options
     */
    public async createVolume(options?: Dockerode.VolumeCreateOptions): Promise<Dockerode.VolumeCreateResponse> {
        return await this.#instance.createVolume(options ? options : {})
    }

    /**
     * Create docker network
     * @param options
     */
    public async createNetwork(options: Dockerode.NetworkCreateOptions): Promise<Dockerode.Network> {
        return await this.#instance.createNetwork(options)
    }

    /**
     * Search docker images
     * @param options
     */
    public async searchImages(options: {}): Promise<any> {
        return await this.#instance.searchImages(options)
    }

    /**
     * Prune docker images
     * @param options
     */
    public async pruneImages(options?: {}): Promise<Dockerode.PruneImagesInfo> {
        return await this.#instance.pruneImages(options ? options : {})
    }

    /**
     * Prune docker containers
     * @param options
     */
    public async pruneContainers(options?: {}): Promise<Dockerode.PruneContainersInfo> {
        return await this.#instance.pruneContainers(options ? options : {})
    }

    /**
     * Prune docker volumes
     * @param options
     */
    public async pruneVolumes(options?: Dockerode.VolumePruneOptions): Promise<Dockerode.PruneVolumesInfo> {
        return await this.#instance.pruneVolumes(options ? options : {})
    }

    /**
     * Prune docker networks
     * @param options
     */
    public async pruneNetworks(options?: {}): Promise<Dockerode.PruneNetworksInfo> {
        return await this.#instance.pruneNetworks(options ? options : {})
    }

    /**
     * Get docker info
     */
    public async info(): Promise<any> {
        return await this.#instance.info()
    }

    /**
     * Pull image
     * @param repoTag
     * @param options
     * @param auth
     * @param outputCallback
     */
    public async pull(repoTag: string, options: {}, auth?: {}, outputCallback?: (output: Record<string, any>) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            this.#instance.pull(repoTag, options, (error: Error, stream: IncomingMessage) => {
                if (error) return reject(error)
                createInterface({
                    input: stream
                })
                    .on('line', (line: string) => {
                        if (outputCallback) outputCallback(JSON.parse(line))
                    })
                    .once('close', () => resolve())
            }, auth)
        })
    }

    /**
     * Run container
     * @param image
     * @param cmd
     * @param createOptions
     * @param startOptions
     */
    public async run(image: string, cmd: string[], createOptions?: Dockerode.ContainerCreateOptions, startOptions?: Dockerode.ContainerStartOptions): Promise<DockerContainer> {
        createOptions = createOptions ? createOptions : {}
        startOptions = startOptions ? startOptions : {}
        const container: DockerContainer = await this.createContainer({
            ...createOptions,
            Image: image,
            Cmd: cmd
        })
        await container.start(startOptions)
        return container
    }

    /**
     * Get docker version
     */
    public dockerVersion(): Dockerode.DockerVersion {
        return this.#dockerVersion
    }

    /**
     * Get docker container
     * @param id
     */
    public getContainer(id: string): DockerContainer {
        return this.#instance.getContainer(id)
    }

    /**
     * Get docker image
     * @param name
     */
    public getImage(name: string): DockerImage {
        return this.#instance.getImage(name)
    }

    /**
     * Get docker volume
     * @param name
     */
    public getVolume(name: string): DockerVolume {
        return this.#instance.getVolume(name)
    }

    /**
     * Get docker network
     * @param id
     */
    public getNetwork(id: string): DockerNetwork {
        return this.#instance.getNetwork(id)
    }
}
