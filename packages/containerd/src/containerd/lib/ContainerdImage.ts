import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {Time} from '@lakutata/utils/Time'
import {type Message} from '@lakutata/grpc'
import type {ImageStore, ResolvedImage} from '../../client/ImageStore.js'
import type {RegistryOptions} from '../../client/Registry.js'
import {FormatPlatform, ParsePlatform, type Platform} from '../../client/Platforms.js'
import {ParseReference} from '../../client/Reference.js'
import {type Containerd} from '../Containerd.js'
import type {ContainerdImageConfig} from '../types/ContainerdImageConfig.js'
import {ImagePushOptions} from '../options/image/ImagePushOptions.js'
import {ImageExportOptions} from '../options/image/ImageExportOptions.js'
import {ContainerdImagePushException} from '../exceptions/ContainerdImagePushException.js'
import {ContainerdImageExportException} from '../exceptions/ContainerdImageExportException.js'
import {ContainerdError} from './ContainerdErrors.js'

/**
 * An image of containerd
 */
@Transient()
export class ContainerdImage extends Provider {

    @Configurable(DTO.Function())
    protected readonly getStore: () => ImageStore

    @Configurable(DTO.Function())
    protected readonly getContainerd: () => Containerd

    @Configurable(DTO.Function())
    protected readonly getRegistryOptions: () => RegistryOptions

    /**
     * The name of the image (docker.io/library/alpine:3.20)
     */
    @Configurable(DTO.String())
    public name: string

    /**
     * The digest of its target (its index, or its manifest)
     */
    public digest: string

    public mediaType: string

    public labels: Record<string, string>

    public createdAt: Time

    public updatedAt: Time

    /**
     * The platforms the content store has (the ones pulled)
     */
    public platforms: string[]

    /**
     * The platform described (the one of the machine, or the first one pulled)
     */
    public platform: string

    public os: string

    public arch: string

    public variant: string | undefined

    /**
     * The size of the platform described (its configuration and its layers, compressed)
     */
    public size: number

    public config: ContainerdImageConfig

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await this.syncImageInfo()
    }

    /**
     * Sync image info from containerd
     */
    public async syncImageInfo(): Promise<void> {
        const store: ImageStore = this.getStore()
        let resolved: ResolvedImage
        let platforms: Platform[]
        try {
            platforms = await store.platforms(this.name)
            const supported: string[] = this.getContainerd().supportedPlatforms()
            const preferred: Platform | undefined = platforms.find((platform: Platform): boolean => supported.includes(FormatPlatform(platform))) ?? platforms[0]
            resolved = await store.resolve(this.name, preferred)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
        const image: Message = resolved.image
        const config = resolved.config.config ?? {}
        this.name = image.name
        this.digest = image.target.digest
        this.mediaType = image.target.mediaType
        this.labels = image.labels ?? {}
        this.createdAt = new Time(TimestampMilliseconds(image.createdAt))
        this.updatedAt = new Time(TimestampMilliseconds(image.updatedAt))
        this.platforms = platforms.map(FormatPlatform)
        this.platform = FormatPlatform(resolved.platform)
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
     * Name the image again
     * @param name
     */
    @Accept(DTO.String().required())
    public async tag(name: string): Promise<ContainerdImage> {
        try {
            return await this.getContainerd().getImage(await this.getStore().tag(this.name, name))
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }

    /**
     * Push the image to its registry (or to another reference)
     * @param options
     */
    @Accept(ImagePushOptions.optional())
    public async push(options?: ImagePushOptions): Promise<void> {
        if (!options) return await this.push({})
        const registry: RegistryOptions = this.getRegistryOptions()
        try {
            await this.getStore().push(this.name, {
                reference: options.reference,
                platform: options.platform ? ParsePlatform(options.platform) : undefined,
                registry: options.auth ? {...registry, credentials: {...registry.credentials, [ParseReference(options.reference ?? this.name).registry]: options.auth}} : registry,
                progress: options.progressCallback
            })
        } catch (error: unknown) {
            throw ContainerdError(error, ContainerdImagePushException)
        }
    }

    /**
     * Export the image into an archive (an OCI image layout, loaded by docker load and nerdctl load)
     * @param options
     */
    @Accept(ImageExportOptions.required())
    public async export(options: ImageExportOptions): Promise<void> {
        try {
            await this.getStore().export([this.name], options.destination)
        } catch (error: unknown) {
            throw ContainerdError(error, ContainerdImageExportException)
        }
    }

    /**
     * Remove the image (its content and its snapshots are collected once no other image nor container uses them)
     */
    public async remove(): Promise<void> {
        try {
            await this.getStore().remove(this.name)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }
}

/**
 * The milliseconds of a Timestamp
 * @param timestamp
 */
function TimestampMilliseconds(timestamp: Message | undefined): number {
    return timestamp ? Number(timestamp.seconds ?? 0) * 1000 + Math.floor(Number(timestamp.nanos ?? 0) / 1e6) : Date.now()
}

