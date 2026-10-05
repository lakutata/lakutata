import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {Time} from '@lakutata/utils/Time'
import {type Message} from '@lakutata/grpc'
import type {ImageStore, ResolvedImage} from '../../client/ImageStore.js'
import type {RegistryOptions} from '../../client/Registry.js'
import {formatPlatform, parsePlatform, type Platform} from '../../client/Platforms.js'
import {parseReference} from '../../client/Reference.js'
import {type Containerd} from '../Containerd.js'
import type {ContainerdImageConfig} from '../types/ContainerdImageConfig.js'
import {ImagePushOptions} from '../options/image/ImagePushOptions.js'
import {ImageExportOptions} from '../options/image/ImageExportOptions.js'
import {ContainerdImagePushException} from '../exceptions/ContainerdImagePushException.js'
import {ContainerdImageExportException} from '../exceptions/ContainerdImageExportException.js'
import {containerdError} from './ContainerdErrors.js'

/**
 * An image of the {@link Containerd} component's namespace: its name, digest, platforms, size and configuration, and
 * the operations tag, push, export and remove. Get it from {@link Containerd.getImage}, {@link Containerd.listImages},
 * {@link Containerd.pullImage}, {@link Containerd.buildImage}, {@link Containerd.importImage} or
 * {@link ContainerdContainer.commit}; do not create it yourself. Each call returns a new object (transient).
 *
 * An image may hold several platforms (an index): the object describes one of them, the first one the machine runs
 * ({@link Containerd.supportedPlatforms}), or the first one present. Its properties are a snapshot taken when it was
 * obtained; {@link ContainerdImage.syncImageInfo} takes a new one.
 * @example
 * ```typescript
 * import {type Containerd, type ContainerdImage} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const image: ContainerdImage = await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm64']})
 * //docker.io/library/alpine:3.20, its platforms, the command its containers run
 * console.log(image.name, image.platforms, image.config.cmd)
 * const tagged: ContainerdImage = await image.tag('registry.example.com/team/alpine:3.20')
 * await tagged.push({auth: {username: 'deploy', password: 'secret'}})
 * //An archive loaded by docker load and nerdctl load
 * await image.export({destination: '/tmp/alpine.tar'})
 * await tagged.remove()
 * ```
 */
@Transient()
export class ContainerdImage extends Provider {

    /**
     * Gives the component's image store; set by the component.
     */
    @Configurable(DTO.Function())
    protected readonly getStore: () => ImageStore

    /**
     * Gives the component that created the object.
     */
    @Configurable(DTO.Function())
    protected readonly getContainerd: () => Containerd

    /**
     * Gives the component's registry options (credentials, insecure registries) for the pushes.
     */
    @Configurable(DTO.Function())
    protected readonly getRegistryOptions: () => RegistryOptions

    /**
     * The image's name, normalized as Docker does (`docker.io/library/alpine:3.20`).
     */
    @Configurable(DTO.String())
    public name: string

    /**
     * The digest of the image's target: its index for a multi-platform image, else its manifest (`sha256:…`), as a
     * registry knows it.
     */
    public digest: string

    /**
     * The media type of the image's target: an OCI or Docker index, or a manifest.
     */
    public mediaType: string

    /**
     * The labels of the image's containerd record (not the ones of its configuration: see `config.labels`).
     */
    public labels: Record<string, string>

    /**
     * When the image was created in containerd (pulled, imported, built).
     */
    public createdAt: Time

    /**
     * When the image's record was last updated in containerd (pulled again, tagged over).
     */
    public updatedAt: Time

    /**
     * The platforms whose content is present (the ones pulled), formatted `os/architecture[/variant]`.
     */
    public platforms: string[]

    /**
     * The platform the object describes: the first one the machine runs, or the first one present.
     */
    public platform: string

    /**
     * The operating system of the platform described (`linux`).
     */
    public os: string

    /**
     * The architecture of the platform described (`amd64`, `arm64`).
     */
    public arch: string

    /**
     * The variant of the platform described (`v8`, `v7`); `undefined` when it has none.
     */
    public variant: string | undefined

    /**
     * The size of the platform described, in bytes: its configuration and its compressed layers.
     */
    public size: number

    /**
     * The configuration the image gives its containers, for the platform described: environment, command, entry point,
     * working directory, user, exposed ports, volumes, labels and stop signal.
     */
    public config: ContainerdImageConfig

    /**
     * Read the image's information.
     * @throws {ContainerdImageNotFoundException} The image does not exist.
     * @throws {ContainerdPlatformException} The content of none of its platforms is present.
     * @protected
     */
    protected async init(): Promise<void> {
        await this.syncImageInfo()
    }

    /**
     * Read the image's information again from containerd into the object's properties.
     * @throws {ContainerdImageNotFoundException} The image no longer exists.
     * @throws {ContainerdPlatformException} The content of none of its platforms is present.
     */
    public async syncImageInfo(): Promise<void> {
        const store: ImageStore = this.getStore()
        let resolved: ResolvedImage
        let platforms: Platform[]
        try {
            platforms = await store.platforms(this.name)
            const supported: string[] = this.getContainerd().supportedPlatforms()
            const preferred: Platform | undefined = platforms.find((platform: Platform): boolean => supported.includes(formatPlatform(platform))) ?? platforms[0]
            resolved = await store.resolve(this.name, preferred)
        } catch (error: unknown) {
            throw containerdError(error)
        }
        const image: Message = resolved.image
        const config = resolved.config.config ?? {}
        this.name = image.name
        this.digest = image.target.digest
        this.mediaType = image.target.mediaType
        this.labels = image.labels ?? {}
        this.createdAt = new Time(timestampMilliseconds(image.createdAt))
        this.updatedAt = new Time(timestampMilliseconds(image.updatedAt))
        this.platforms = platforms.map(formatPlatform)
        this.platform = formatPlatform(resolved.platform)
        this.os = resolved.platform.os
        this.arch = resolved.platform.architecture
        this.variant = resolved.platform.variant
        this.size = Number(resolved.manifest.config.size) + resolved.manifest.layers.reduce((size: number, layer): number => size + Number(layer.size), 0)
        this.config = {
            env: Object.fromEntries((config.Env ?? []).map((entry: string): [string, string] => [entry.split('=')[0], entry.slice(entry.indexOf('=') + 1)])),
            cmd: config.Cmd ?? [],
            entrypoint: config.Entrypoint ?? [],
            workingDir: config.WorkingDir ?? '',
            user: config.User ?? '',
            exposedPorts: Object.keys(config.ExposedPorts ?? {}).map((key: string): ContainerdImageConfig['exposedPorts'][number] => {
                const [port, type] = key.split('/')
                return {port: Number(port), type: (type ?? 'tcp') as 'tcp' | 'udp' | 'sctp'}
            }),
            volumes: Object.keys(config.Volumes ?? {}),
            labels: config.Labels ?? {},
            stopSignal: config.StopSignal
        }
    }

    /**
     * Give the image another name, as `docker tag` does: a new image record with the same content. An image that has
     * this name already is replaced. This object keeps its name.
     * @param name The new name or reference (`registry.example.com/team/alpine:3.20`), normalized as Docker does.
     * @returns The image under its new name.
     * @throws {ContainerdImageNotFoundException} The image no longer exists.
     */
    @Accept(DTO.String().required())
    public async tag(name: string): Promise<ContainerdImage> {
        try {
            return await this.getContainerd().getImage(await this.getStore().tag(this.name, name))
        } catch (error: unknown) {
            throw containerdError(error)
        }
    }

    /**
     * Push the image to its registry, or to another reference. With `platform`, only the manifest of that platform is
     * pushed under the tag. Without it, when the content of all the platforms of its index is present, all of them and
     * the index are pushed; otherwise only the manifest of the machine's platform. The credentials are `auth`, else the
     * component's `registryAuths`. The push is aborted when the component is destroyed.
     * @param options The `reference` to push to (the image's name by default), the `platform`, the credentials and the
     * progress callback.
     * @throws {ContainerdImageNotFoundException} The image no longer exists.
     * @throws {ContainerdPlatformException} The platform to push (`platform`, or the machine's when only some platforms
     * are present) is not present.
     * @throws {ContainerdImagePushException} The registry cannot be reached or refuses the push (credentials, rights).
     */
    @Accept(ImagePushOptions.optional())
    public async push(options?: ImagePushOptions): Promise<void> {
        if (!options) return await this.push({})
        const registry: RegistryOptions = this.getRegistryOptions()
        try {
            await this.getStore().push(this.name, {
                reference: options.reference,
                platform: options.platform ? parsePlatform(options.platform) : undefined,
                registry: options.auth ? {...registry, credentials: {...registry.credentials, [parseReference(options.reference ?? this.name).registry]: options.auth}} : registry,
                progress: options.progressCallback
            })
        } catch (error: unknown) {
            throw containerdError(error, ContainerdImagePushException)
        }
    }

    /**
     * Export the image into an archive: an OCI image layout with the `manifest.json` of `docker load`, loaded by
     * `docker load`, `nerdctl load` and {@link Containerd.importImage}.
     * @param options The destination: a file path (created or replaced) or a writable stream.
     * @throws {ContainerdImageNotFoundException} The image no longer exists.
     * @throws {ContainerdImageExportException} The archive cannot be written.
     */
    @Accept(ImageExportOptions.required())
    public async export(options: ImageExportOptions): Promise<void> {
        try {
            await this.getStore().export([this.name], options.destination)
        } catch (error: unknown) {
            throw containerdError(error, ContainerdImageExportException)
        }
    }

    /**
     * Remove the image's name. Its content and snapshots are collected by containerd once no other image and no
     * container uses them; the containers of the image keep working.
     * @throws {ContainerdImageNotFoundException} The image no longer exists.
     */
    public async remove(): Promise<void> {
        try {
            await this.getStore().remove(this.name)
        } catch (error: unknown) {
            throw containerdError(error)
        }
    }
}

/**
 * The milliseconds of a Timestamp
 * @param timestamp
 */
function timestampMilliseconds(timestamp: Message | undefined): number {
    return timestamp ? Number(timestamp.seconds ?? 0) * 1000 + Math.floor(Number(timestamp.nanos ?? 0) / 1e6) : Date.now()
}

