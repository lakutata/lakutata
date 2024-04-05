import {Component} from '../../lib/core/Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {DockerImage} from './lib/DockerImage.js'
import {DockerContainer} from './lib/DockerContainer.js'
import {DockerNetwork} from './lib/DockerNetwork.js'
import {platform} from 'os'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/core/DTO.js'
import {KeyObject} from '../DockerOld.js'
import Dockerode from 'dockerode'
import {DockerConnectionException} from './exceptions/DockerConnectionException.js'
import {DockerImageNotFoundException} from './exceptions/DockerImageNotFoundException.js'
import {ImagePullOptions} from './options/ImagePullOptions.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {createInterface} from 'node:readline'
import {DockerImagePullException} from './exceptions/DockerImagePullException.js'
import {IsAbortError} from '../../lib/functions/IsAbortError.js'

@Singleton()
export class Docker extends Component {

    @Configurable(DTO.String().optional())
    protected readonly socketPath?: string | undefined

    @Configurable(DTO.String().optional())
    protected readonly host?: string | undefined

    @Configurable(DTO.Alternatives(
        DTO.Number().port(),
        DTO.String()
    ).optional())
    protected readonly port?: number | string | undefined

    @Configurable(DTO.String().optional())
    protected readonly username?: string | undefined

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    protected readonly headers?: { [name: string]: string }

    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary())
    ).optional())
    protected readonly ca?: string | string[] | Buffer | Buffer[] | undefined

    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary())
    ).optional())
    protected readonly cert?: string | string[] | Buffer | Buffer[] | undefined

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
    protected readonly key?: string | string[] | Buffer | Buffer[] | KeyObject[] | undefined

    @Configurable(DTO.String().valid('https', 'http', 'ssh').optional())
    protected readonly protocol?: 'https' | 'http' | 'ssh' | undefined

    @Configurable(DTO.Number().optional())
    protected readonly timeout?: number | undefined

    @Configurable(DTO.String().optional())
    protected readonly version?: string | undefined

    @Configurable(DTO.String().optional())
    protected readonly sshAuthAgent?: string | undefined

    #instance: Dockerode

    #abortController: AbortController = new AbortController()

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            new Promise((resolve, reject) => this.container.register(DockerImage).then(resolve).catch(reject)),
            new Promise((resolve, reject) => this.container.register(DockerContainer).then(resolve).catch(reject)),
            new Promise((resolve, reject) => this.container.register(DockerNetwork).then(resolve).catch(reject))
        ])
        if (!this.socketPath && !this.host) {
            //Load default config
            switch (platform()) {
                case 'win32': {
                    this.#instance = new Dockerode({
                        host: 'localhost',
                        port: 2375
                    })
                }
                    break
                default: {
                    this.#instance = new Dockerode({
                        socketPath: '/var/run/docker.sock'
                    })
                }
            }
        } else {
            //Load passed config
            this.#instance = new Dockerode({
                socketPath: this.socketPath,
                host: this.host,
                port: this.port,
                username: this.username,
                headers: this.headers,
                ca: this.ca,
                cert: this.cert,
                key: this.key,
                protocol: this.protocol,
                timeout: this.timeout,
                version: this.version,
                sshAuthAgent: this.sshAuthAgent
            })
        }
        try {
            await this.#instance.ping()
        } catch (e: any) {
            throw new DockerConnectionException(e.message ? e.message : 'Cannot connect to docker')
        }
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
    }

    /** Docker Common Operations **/

    //TODO

    /** Docker Image Operations **/

    /**
     * List docker images
     */
    public async listImages(): Promise<DockerImage[]> {
        const rawImages: Dockerode.ImageInfo[] = await this.#instance.listImages()
        return await Promise.all(rawImages.map((rawImage: Dockerode.ImageInfo) => new Promise<DockerImage>((resolve, reject) => this.container.get(DockerImage, {
            id: rawImage.Id,
            $dockerode: this.#instance,
            $abortController: this.#abortController
        }).then(resolve).catch(reject))))
    }

    /**
     * Pull docker image from repository
     */
    @Accept(ImagePullOptions.required())
    public async pullImage(options: ImagePullOptions): Promise<DockerImage> {
        const auth: Dockerode.AuthConfig | undefined = options.auth ? {
            username: options.auth.username,
            password: options.auth.password,
            serveraddress: options.auth.serverAddress,
            email: options.auth.email
        } : undefined
        const tag: string = options.tag ? options.tag : 'latest'
        const createImageOptions: Record<string, any> = {
            fromImage: options.repo,
            tag: tag,
            platform: options.platform,
            abortSignal: this.#abortController.signal
        }
        try {
            const readableStream: NodeJS.ReadableStream = auth ? await this.#instance.createImage(auth, createImageOptions) : await this.#instance.createImage(createImageOptions)
            await new Promise<void>((resolve, reject) => {
                createInterface({
                    input: readableStream
                })
                    .on('line', (line: string) => {
                        const outputObject: Record<string, any> = JSON.parse(line)
                        if (options.outputCallback) options.outputCallback(outputObject)
                        if (outputObject.error) return reject(new Error(outputObject.error))
                    })
                    .once('close', () => resolve())
            })
            return await this.getImage(`${options.repo}:${tag}`)
        } catch (e: any) {
            if (!IsAbortError(e)) throw new DockerImagePullException(e.message)
            return undefined as any
        }
    }

    /**
     * Build docker image
     */
    public async buildImage() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Import docker image from .tar file
     */
    public async importImage() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Get docker image
     * @param repoTagOrId
     */
    @Accept(DTO.String().required())
    public async getImage(repoTagOrId: string): Promise<DockerImage> {
        const images: DockerImage[] = await this.listImages()
        const result: DockerImage[] = images
            .filter((image: DockerImage) => {
                if (image.id === repoTagOrId) return true
                if (image.repoTags.includes(repoTagOrId)) return true
                return false
            })
            .sort((image: DockerImage) => image.id === repoTagOrId ? -1 : 0)
        const image: DockerImage | undefined = result[0]
        if (!image) throw new DockerImageNotFoundException('Docker image {0} not found', [repoTagOrId])
        return image
    }

    /** Docker Container Operations **/

    /**
     * List docker containers
     */
    public async listContainers() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Get docker container
     */
    public async getContainer() {
        //TODO
        throw new Error('not implemented')
    }

    /** Docker Network Operations **/

    /**
     * Create docker network
     */
    public async createNetwork() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Remove docker network
     */
    public async removeNetwork() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * List docker networks
     */
    public async listNetworks() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Get docker network info
     */
    public async getNetwork() {
        //TODO
        throw new Error('not implemented')
    }
}