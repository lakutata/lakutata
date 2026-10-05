import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import type {DockerClient} from '../../client/DockerClient.js'
import {FollowProgress} from '../../client/DockerStreams.js'
import {Time} from '@lakutata/utils/Time'
import {ImageConfig} from '../types/ImageConfig.js'
import {ImageTagOptions} from '../options/image/ImageTagOptions.js'
import {Accept} from '@lakutata/core/decorator/dto'
import {ImageExportOptions} from '../options/image/ImageExportOptions.js'
import {createWriteStream} from 'node:fs'
import {pipeline} from 'stream/promises'
import {DockerImageRepoTagNotFoundException} from '../exceptions/DockerImageRepoTagNotFoundException.js'
import {ImageRemoveOptions} from '../options/image/ImageRemoveOptions.js'
import {ImagePushOptions} from '../options/image/ImagePushOptions.js'
import {DockerImagePushException} from '../exceptions/DockerImagePushException.js'
import {isAbortError, As} from '@lakutata/utils'
import {parseRepositoryTag} from './ParseRepositoryTag.js'
import {ImageExposePort} from '../types/ImageExposePort.js'
import {parseEnvToRecord} from './ParseEnvToRecord.js'
import type {Docker} from '../Docker.js'
import {ContainerSettingOptions} from '../options/container/ContainerSettingOptions.js'
import {type DockerContainer} from './DockerContainer.js'
import {RegistryAuth} from './RegistryAuth.js'

/**
 * An image of the Docker daemon, with its tags, platform, size and configuration as inspected, and its operations: tag,
 * export, push, remove, and run a container. It is not created with `new`: {@link Docker.getImage},
 * {@link Docker.listImages}, {@link Docker.pullImage}, {@link Docker.buildImage}, {@link Docker.importImage} and
 * {@link DockerContainer.commit} return it.
 *
 * Its properties are a snapshot, taken when it is obtained and refreshed by `tag()` and `push()`. Its operations reject
 * with {@link DockerImageNotFoundException} when the image was removed, with {@link DockerRequestException} when the
 * daemon refuses them otherwise (used by a container: HTTP 409), and with the network error of Node.js when the daemon
 * cannot be reached.
 * @example
 * ```typescript
 * import {type Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image: DockerImage = await docker.buildImage({workdir: '/srv/app', files: ['Dockerfile', 'src', 'package.json'], repoTag: 'app:1.0.0'})
 * console.log(image.id, image.platform, image.size, image.config.ports)
 * await image.tag({repo: 'registry.example.com/team/app', tag: '1.0.0'})
 * await image.push({
 *     repo: 'registry.example.com/team/app',
 *     tag: '1.0.0',
 *     auth: {serverAddress: 'registry.example.com', username: 'ci', password: 'secret'}
 * })
 * await image.export({destination: '/tmp/app-1.0.0.tar', repoTag: 'app:1.0.0'})
 * const container: DockerContainer = await image.run({name: 'app', ports: [{port: 3000, type: 'tcp', hostPorts: [3000]}]})
 * console.log(container.state.status)
 * ```
 */
@Transient()
export class DockerImage extends Provider {

    readonly #abortController: AbortController = new AbortController()

    /**
     * Give the client of the Engine API: set by the {@link Docker} component creating the object.
     */
    @Configurable(DTO.Function())
    protected readonly getClient: () => DockerClient

    /**
     * Give the {@link Docker} component which created the object.
     */
    @Configurable(DTO.Function())
    protected readonly getDocker: () => Docker

    /**
     * The full ID of the image (`sha256:…`).
     */
    @Configurable(DTO.String())
    public id: string

    /**
     * The tags of the image (`['alpine:3.20', 'alpine:latest']`); empty for an untagged image.
     */
    public repoTags: string[]

    /**
     * When the image was built.
     */
    public createdAt: Time

    /**
     * The CPU architecture of the image (`amd64`, `arm64`).
     */
    public arch: string

    /**
     * The operating system of the image (`linux`).
     */
    public os: string

    /**
     * The platform of the image, `os/arch` (`linux/arm64`): the one its containers are created for by
     * {@link DockerImage.run}.
     */
    public platform: string

    /**
     * The size of the image, in bytes.
     */
    public size: number

    /**
     * The configuration of the image: its default host name, user, environment, command, entrypoint, volumes and exposed
     * ports.
     */
    public config: ImageConfig

    /**
     * Inspect the image.
     * @throws {DockerImageNotFoundException} When the image does not exist.
     * @protected
     */
    protected async init(): Promise<void> {
        await this.syncImageInfo()
    }

    /**
     * Abort the export in progress of the object (the image itself is left as it is).
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
    }

    /**
     * Refresh the properties from the daemon's inspection of the image.
     * @throws {DockerImageNotFoundException} When the image does not exist.
     * @protected
     */
    protected async syncImageInfo(): Promise<void> {
        const inspectInfo: Record<string, any> = await this.getClient().inspectImage(this.id)
        this.repoTags = inspectInfo.RepoTags
        this.createdAt = new Time(inspectInfo.Created)
        this.arch = inspectInfo.Architecture
        this.os = inspectInfo.Os
        this.platform = `${this.os}/${this.arch}`
        this.size = inspectInfo.Size
        const exposePorts: ImageExposePort[] = []
        const exposePortMap: Map<number, Omit<ImageExposePort, 'port'>> = new Map()
        if (inspectInfo.Config.ExposedPorts) {
            Object.keys(inspectInfo.Config.ExposedPorts).forEach((portWithType: string): void => {
                const portInfos: string[] = portWithType.split('/')
                const port: number = parseInt(portInfos[0])
                const type: 'tcp' | 'udp' = As<'tcp' | 'udp'>(portInfos[1].toLowerCase())
                if (!exposePortMap.has(port)) exposePortMap.set(port, {tcp: false, udp: false})
                const portType: Omit<ImageExposePort, 'port'> = exposePortMap.get(port)!
                portType[type] = true
                exposePortMap.set(port, portType)
            })
            exposePortMap.forEach((portType: Omit<ImageExposePort, 'port'>, port: number) => exposePorts.push({port: port, ...portType}))
        }
        this.config = {
            hostname: inspectInfo.Config.Hostname,
            user: inspectInfo.Config.User,
            env: parseEnvToRecord(inspectInfo.Config.Env),
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
     * Add a tag to the image, as `docker tag`, then refresh its properties. A tag already given to another image moves to
     * this one.
     * @param options The repository (`registry.example.com/team/app`) and the tag (`latest` by default).
     * @throws {DockerImageNotFoundException} When the image was removed.
     * @throws {DockerRequestException} When the name is invalid (HTTP 400).
     */
    @Accept(ImageTagOptions.required())
    public async tag(options: ImageTagOptions): Promise<void> {
        try {
            await this.getClient().tagImage(this.id, {repo: options.repo, tag: options.tag})
            await this.syncImageInfo()
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * Save the image as a tar archive, as `docker save`, which {@link Docker.importImage} loads. With `repoTag`, the
     * archive holds that tag (restored when it is loaded); without it, the image is saved by ID, without its tags.
     * @param options The `destination` (a file path, created or overwritten, or a writable stream, ended after the
     * archive), the tag saved (`repoTag`), and `createRepoTagIfNotExists` (`true` by default) to add that tag to the image
     * when it does not have it.
     * @throws {DockerImageRepoTagNotFoundException} When the image does not have `repoTag` and
     * `createRepoTagIfNotExists` is `false`.
     * @throws {DockerImageNotFoundException} When the image was removed.
     * @throws {Error} The error of the destination.
     */
    @Accept(ImageExportOptions.required())
    public async export(options: ImageExportOptions): Promise<void> {
        try {
            let name: string = this.id
            if (options.repoTag) {
                if (!this.repoTags.includes(options.repoTag)) {
                    if (!options.createRepoTagIfNotExists) throw new DockerImageRepoTagNotFoundException('The current image does not contain the RepoTag of {0}', [options.repoTag])
                    const {repo, tag} = parseRepositoryTag(options.repoTag)
                    await this.tag({repo: repo, tag: tag})
                }
                name = options.repoTag
            }
            const readableStream: NodeJS.ReadableStream = await this.getClient().exportImage(name)
            const destStream: NodeJS.WritableStream = typeof options.destination === 'string'
                ? createWriteStream(options.destination, {signal: this.#abortController.signal})
                : options.destination
            await pipeline(readableStream, destStream)
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * Push the image to its registry, as `docker push`, and wait for its end. The image is first tagged `repo:tag` (the
     * tag is kept afterwards).
     * @param options The repository, with its registry (`registry.example.com/team/app`); the tag (`latest` by default);
     * the registry credentials; and a callback receiving each progress message.
     * @throws {DockerImagePushException} When the registry refuses the push (refused credentials, a repository not
     * found).
     * @throws {DockerImageNotFoundException} When the image was removed.
     * @throws {DockerRequestException} When the daemon refuses to push it.
     */
    @Accept(ImagePushOptions.required())
    public async push(options: ImagePushOptions) {
        const tag: string = options.tag ? options.tag : 'latest'
        await this.tag({repo: options.repo, tag: tag})
        await this.syncImageInfo()
        let pushException: DockerImagePushException | undefined
        const readableStream: NodeJS.ReadableStream = await this.getClient().pushImage(options.repo, {tag: tag}, RegistryAuth(options.auth))
        await FollowProgress(readableStream, (outputObject: Record<string, any>): void => {
            if (outputObject.error && !pushException) pushException = new DockerImagePushException(outputObject.error)
            if (options.outputCallback) options.outputCallback(outputObject)
        })
        if (pushException) throw pushException
    }

    /**
     * Remove the image, as `docker rmi -f` by default: forced, it is removed with all its tags, even when a stopped
     * container uses it.
     * @param options `force` (`true` by default; `false` refuses an image with several tags or used by a container) and
     * `noprune` (keeps its untagged parent images; `false` by default).
     * @throws {DockerImageNotFoundException} When the image was already removed.
     * @throws {DockerRequestException} When it is used by a running container or, without `force`, by any container or
     * with several tags (HTTP 409).
     */
    @Accept(ImageRemoveOptions.optional().default({force: true}))
    public async remove(options?: ImageRemoveOptions): Promise<void> {
        try {
            await this.getClient().removeImage(this.id, {force: options?.force, noprune: options?.noprune})
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * Create a container from the image, for its platform, then start it, as `docker run -d`.
     * @param options The container's settings: name, command, environment, ports, binds, devices, networks, limits…
     * @returns The container, started.
     * @throws {DockerRequestException} When the name is already used (HTTP 409), or the start fails (HTTP 500: a command
     * not found, a port already used); the container then stays created.
     * @throws {DockerNetworkNotFoundException} When a network of the settings is not found.
     * @throws {InvalidMethodAcceptException} When the settings are invalid.
     */
    @Accept(ContainerSettingOptions.required())
    public async run(options: ContainerSettingOptions): Promise<DockerContainer> {
        const container: DockerContainer = await this.getDocker().createContainer(this.id, this.platform, options)
        await container.start()
        return container
    }
}
