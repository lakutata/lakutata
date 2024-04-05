import {Provider} from '../../../lib/core/Provider.js'
import {Transient} from '../../../decorators/di/Lifetime.js'
import Dockerode from 'dockerode'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/core/DTO.js'
import {Time} from '../../../lib/core/Time.js'
import {ImageConfig} from '../types/ImageConfig.js'
import {ImageTagOptions} from '../options/ImageTagOptions.js'
import {Accept} from '../../../decorators/dto/Accept.js'
import {ImageExportOptions} from '../options/ImageExportOptions.js'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'stream/promises'
import {DockerImageRepoTagNotFoundException} from '../exceptions/DockerImageRepoTagNotFoundException.js'
import {ImageRemoveOptions} from '../options/ImageRemoveOptions.js'
import {ImagePushOptions} from '../options/ImagePushOptions.js'
import {DockerImagePushException} from '../exceptions/DockerImagePushException.js'
import {createInterface} from 'node:readline'
import {IsAbortError} from '../../../lib/functions/IsAbortError.js'
import {ParseRepositoryTag} from './ParseRepositoryTag.js'

@Transient()
export class DockerImage extends Provider {

    #image: Dockerode.Image

    @Configurable(DTO.InstanceOf(Dockerode))
    protected readonly $dockerode: Dockerode

    @Configurable(DTO.InstanceOf(AbortController))
    protected readonly $abortController: AbortController

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
        let environments: Record<string, string> = {}
        inspectInfo.Config.Env.map((envString: string): Record<string, string> | null => {
            const splitPos: number = envString.indexOf('=')
            if (splitPos === -1) return null
            return {[envString.substring(0, splitPos)]: envString.substring(splitPos + 1)}
        }).forEach((envKeyValuePair: Record<string, string> | null) => {
            if (envKeyValuePair) environments = {...environments, ...envKeyValuePair}
        })
        this.config = {
            hostname: inspectInfo.Config.Hostname,
            user: inspectInfo.Config.User,
            env: environments,
            cmd: inspectInfo.Config.Cmd,
            entrypoint: inspectInfo.Config.Entrypoint
                ? Array.isArray(inspectInfo.Config.Entrypoint)
                    ? inspectInfo.Config.Entrypoint
                    : [inspectInfo.Config.Entrypoint]
                : [],
            volumes: inspectInfo.Config.Volumes ? Object.keys(inspectInfo.Config.Volumes) : []
        }
    }

    /**
     * Tag image
     * @param options
     */
    @Accept(ImageTagOptions.required())
    public async tag(options: ImageTagOptions): Promise<void> {
        try {
            await this.#image.tag({...options, abortSignal: this.$abortController.signal})
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
                ? createWriteStream(options.destination, {signal: this.$abortController.signal})
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
            await this.#image.remove({...options, abortSignal: this.$abortController.signal})
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    public async run() {
        //TODO
    }
}
