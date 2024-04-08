import {Provider} from '../../../lib/core/Provider.js'
import {Transient} from '../../../decorators/di/Lifetime.js'
import Dockerode from 'dockerode'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/core/DTO.js'
import {Time} from '../../../lib/core/Time.js'
import {ImageConfig} from '../types/ImageConfig.js'
import {ImageTagOptions} from '../options/image/ImageTagOptions.js'
import {Accept} from '../../../decorators/dto/Accept.js'
import {ImageExportOptions} from '../options/image/ImageExportOptions.js'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'stream/promises'
import {DockerImageRepoTagNotFoundException} from '../exceptions/DockerImageRepoTagNotFoundException.js'
import {ImageRemoveOptions} from '../options/image/ImageRemoveOptions.js'
import {ImagePushOptions} from '../options/image/ImagePushOptions.js'
import {DockerImagePushException} from '../exceptions/DockerImagePushException.js'
import {createInterface} from 'node:readline'
import {IsAbortError} from '../../../lib/functions/IsAbortError.js'
import {ParseRepositoryTag} from './ParseRepositoryTag.js'
import {As} from '../../../lib/functions/As.js'
import {ImageExposePort} from '../types/ImageExposePort.js'
import {ParseEnvToRecord} from './ParseEnvToRecord.js'

@Transient()
export class DockerImage extends Provider {

    readonly #abortController: AbortController = new AbortController()

    #image: Dockerode.Image

    @Configurable(DTO.InstanceOf(Dockerode))
    protected readonly $dockerode: Dockerode

    @Configurable(DTO.String())
    public id: string

    public repoTags: string[]

    public createdAt: Time

    public arch: string

    public os: string

    public platform: string

    public size: number

    public config: ImageConfig

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#image = this.$dockerode.getImage(this.id)
        await this.syncImageInfo()
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
    }

    /**
     * Sync image info from docker
     * @protected
     */
    protected async syncImageInfo(): Promise<void> {
        const inspectInfo: Dockerode.ImageInspectInfo = await this.#image.inspect()
        this.repoTags = inspectInfo.RepoTags
        this.createdAt = new Time(inspectInfo.Created)
        this.arch = inspectInfo.Architecture
        this.os = inspectInfo.Os
        this.platform = `${this.os}/${this.arch}`
        this.size = inspectInfo.Size
        const exposePorts: ImageExposePort[] = []
        const exposePortMap: Map<number, {
            tcp: boolean
            udp: boolean
        }> = new Map()
        if (inspectInfo.Config.ExposedPorts) {
            Object.keys(inspectInfo.Config.ExposedPorts).forEach((portWithType: string): void => {
                const portInfos: string[] = portWithType.split('/')
                const port: number = parseInt(portInfos[0])
                const type: 'tcp' | 'udp' = As<'tcp' | 'udp'>(portInfos[1].toLowerCase())
                if (!exposePortMap.has(port)) exposePortMap.set(port, {tcp: false, udp: false})
                const portType: {
                    tcp: boolean
                    udp: boolean
                } = exposePortMap.get(port)!
                portType[type] = true
                exposePortMap.set(port, portType)
            })
            exposePortMap.forEach((portType: {
                tcp: boolean;
                udp: boolean
            }, port: number) => exposePorts.push({port: port, ...portType}))
        }
        this.config = {
            hostname: inspectInfo.Config.Hostname,
            user: inspectInfo.Config.User,
            env: ParseEnvToRecord(inspectInfo.Config.Env),
            cmd: inspectInfo.Config.Cmd,
            entrypoint: inspectInfo.Config.Entrypoint
                ? Array.isArray(inspectInfo.Config.Entrypoint)
                    ? inspectInfo.Config.Entrypoint
                    : [inspectInfo.Config.Entrypoint]
                : [],
            volumes: inspectInfo.Config.Volumes ? Object.keys(inspectInfo.Config.Volumes) : [],
            ports: exposePorts
        }
    }

    /**
     * Tag image
     * @param options
     */
    @Accept(ImageTagOptions.required())
    public async tag(options: ImageTagOptions): Promise<void> {
        try {
            await this.#image.tag({...options, abortSignal: this.#abortController.signal})
            await this.syncImageInfo()
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    /**
     * Export docker image
     * @param options
     */
    @Accept(ImageExportOptions.required())
    public async export(options: ImageExportOptions): Promise<void> {
        try {
            let rawImage: Dockerode.Image
            if (options.repoTag) {
                if (!this.repoTags.includes(options.repoTag)) {
                    if (!options.createRepoTagIfNotExists) throw new DockerImageRepoTagNotFoundException('The current image does not contain the RepoTag of {0}', [options.repoTag])
                    const {repo, tag} = ParseRepositoryTag(options.repoTag)
                    await this.tag({repo: repo, tag: tag})
                }
                rawImage = this.$dockerode.getImage(options.repoTag)
            } else {
                rawImage = this.#image
            }
            const readableStream: NodeJS.ReadableStream = await rawImage.get()
            const destStream: NodeJS.WritableStream = typeof options.destination === 'string'
                ? createWriteStream(options.destination, {signal: this.#abortController.signal})
                : options.destination
            await pipeline(readableStream, destStream)
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    /**
     * Push docker image to repository
     * @param options
     */
    @Accept(ImagePushOptions.required())
    public async push(options: ImagePushOptions) {
        const tag: string = options.tag ? options.tag : 'latest'
        const repoTag: string = `${options.repo}:${tag}`
        await this.tag({repo: options.repo, tag: tag})
        await this.syncImageInfo()
        const readableStream: NodeJS.ReadableStream = await this.$dockerode.getImage(repoTag).push({
            authconfig: options.auth ? {
                username: options.auth.username,
                password: options.auth.password,
                serveraddress: options.auth.serverAddress,
                email: options.auth.email
            } : undefined
        })
        return new Promise<void>((resolve, reject) => {
            let pushException: DockerImagePushException
            createInterface({input: readableStream})
                .on('line', (line: string) => {
                    const outputObject: Record<string, any> = JSON.parse(line)
                    if (outputObject.error) pushException = new DockerImagePushException(outputObject.error)
                    if (options.outputCallback) options.outputCallback(outputObject)
                })
                .once('close', () => {
                    if (pushException) return reject(pushException)
                    return resolve()
                })
        })
    }

    /**
     * Remove docker image
     * @param options
     */
    @Accept(ImageRemoveOptions.optional().default({force: true}))
    public async remove(options?: ImageRemoveOptions): Promise<void> {
        try {
            await this.#image.remove({...options, abortSignal: this.#abortController.signal})
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    public async run() {
        //TODO
    }
}
