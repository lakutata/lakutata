import {Component, DTO} from '@lakutata/core'
import {Singleton, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {ContainerdClient, type ContainerdEvent} from '../client/ContainerdClient.js'
import {ImageStore} from '../client/ImageStore.js'
import {ContainerStore, type ContainerMount} from '../client/ContainerStore.js'
import {FormatPlatform, ParsePlatform, SupportedPlatforms, type Platform} from '../client/Platforms.js'
import {ParseReference} from '../client/Reference.js'
import type {RegistryCredentials, RegistryOptions} from '../client/Registry.js'
import type {Message} from '../client/Protobuf.js'
import {ContainerdImage} from './lib/ContainerdImage.js'
import {ContainerdContainer} from './lib/ContainerdContainer.js'
import {ContainerdError} from './lib/ContainerdErrors.js'
import {ImagePullOptions} from './options/image/ImagePullOptions.js'
import {ImageImportOptions} from './options/image/ImageImportOptions.js'
import {ImageExportOptions} from './options/image/ImageExportOptions.js'
import {ContainerCreateOptions} from './options/container/ContainerCreateOptions.js'
import {ContainerdConnectionException} from './exceptions/ContainerdConnectionException.js'
import {ContainerdImageNotFoundException} from './exceptions/ContainerdImageNotFoundException.js'
import {ContainerdImagePullException} from './exceptions/ContainerdImagePullException.js'
import {ContainerdImageImportException} from './exceptions/ContainerdImageImportException.js'
import {ContainerdImageExportException} from './exceptions/ContainerdImageExportException.js'
import {ContainerdContainerNotFoundException} from './exceptions/ContainerdContainerNotFoundException.js'

/**
 * The containerd component: the images (pulled from the registries for any platform, pushed, imported, exported) and
 * the containers of a namespace of containerd, over its API (its socket), without Docker nor nerdctl; the containers
 * are the ones of nerdctl (its labels), their logs written by the shims of containerd, their restarts kept by its
 * restart monitor
 */
@Singleton()
export class Containerd extends Component {

    /**
     * The socket of containerd
     */
    @Configurable(DTO.String().optional().default('/run/containerd/containerd.sock'))
    protected readonly socketPath: string

    /**
     * The namespace of the images and of the containers (the one of nerdctl: default)
     */
    @Configurable(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).optional().default('default'))
    protected readonly namespace: string

    /**
     * The snapshotter of the containers (overlayfs, native)
     */
    @Configurable(DTO.String().optional().default('overlayfs'))
    protected readonly snapshotter: string

    /**
     * The runtime of the containers
     */
    @Configurable(DTO.String().optional().default('io.containerd.runc.v2'))
    protected readonly runtime: string

    /**
     * The cgroup driver of the runtime: cgroupfs, or systemd (SystemdCgroup of the configuration of containerd)
     */
    @Configurable(DTO.String().valid('cgroupfs', 'systemd').optional().default('cgroupfs'))
    protected readonly cgroupManager: 'cgroupfs' | 'systemd'

    /**
     * The directory of the states of the containers (their logs, their hosts, resolv.conf and hostname)
     */
    @Configurable(DTO.String().optional().default('/var/lib/lakutata/containerd'))
    protected readonly dataRoot: string

    /**
     * The size of the logs of a container rotated (once) at its starts, 0 never
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(0))
    protected readonly logMaxSize: number

    /**
     * The credentials of the registries, by their names (docker.io, registry.example.com:5000)
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Object({
        username: DTO.String().optional(),
        password: DTO.String().optional(),
        identityToken: DTO.String().optional()
    })).optional())
    protected readonly registryAuths?: Record<string, RegistryCredentials>

    /**
     * The registries served over HTTP
     */
    @Configurable(DTO.Array(DTO.String()).optional())
    protected readonly insecureRegistries?: string[]

    #client: ContainerdClient

    #images: ImageStore

    #containers: ContainerStore

    #platforms: string[]

    readonly #abortController: AbortController = new AbortController()

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            this.container.register(ContainerdImage),
            this.container.register(ContainerdContainer)
        ])
        this.#client = new ContainerdClient(this.socketPath, this.namespace)
        try {
            await this.#client.version()
            await this.#client.ensureNamespace()
        } catch (e: any) {
            throw new ContainerdConnectionException(`Cannot connect to containerd (${this.socketPath}): ${e.message}`)
        }
        this.#images = new ImageStore(this.#client, this.snapshotter)
        this.#containers = new ContainerStore(this.#client, this.#images, {
            snapshotter: this.snapshotter,
            runtime: this.runtime,
            cgroupManager: this.cgroupManager,
            dataRoot: this.dataRoot,
            logMaxSize: this.logMaxSize
        })
        this.#platforms = SupportedPlatforms().map(FormatPlatform)
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
        this.#client?.close()
    }

    /**
     * The options of the registries, the credentials of a registry given
     * @param reference
     * @param auth
     * @protected
     */
    protected registryOptions(reference?: string, auth?: RegistryCredentials): RegistryOptions {
        const credentials: Record<string, RegistryCredentials> = {...this.registryAuths ?? {}}
        if (reference && auth) credentials[ParseReference(reference).registry] = auth
        return {credentials: credentials, insecure: this.insecureRegistries ?? [], signal: this.#abortController.signal}
    }

    /** Containerd Common Operations **/

    /**
     * The version of containerd
     */
    public async version(): Promise<{ version: string, revision: string }> {
        return await this.#client.version()
    }

    /**
     * The platforms the machine runs the containers of: its own one, and the ones of the emulators of QEMU registered
     * in binfmt_misc (linux/arm64/v8, linux/amd64, linux/arm/v7…)
     */
    public supportedPlatforms(): string[] {
        return [...this.#platforms]
    }

    /**
     * Detect again the platforms the machine runs (after the registration of emulators)
     */
    public detectPlatforms(): string[] {
        this.#platforms = SupportedPlatforms().map(FormatPlatform)
        return this.supportedPlatforms()
    }

    /**
     * The events of containerd of the namespace (/tasks/exit, /containers/create, /images/delete…), until the signal
     * aborts
     * @param signal
     */
    public async* events(signal?: AbortSignal): AsyncGenerator<ContainerdEvent> {
        const abort: AbortSignal = signal ? AbortSignal.any([signal, this.#abortController.signal]) : this.#abortController.signal
        yield* this.#client.subscribe([`namespace==${this.namespace}`], abort)
    }

    /** Containerd Image Operations **/

    /**
     * List images
     */
    public async listImages(): Promise<ContainerdImage[]> {
        const images: Message[] = await this.#client.listImages()
        const result: ContainerdImage[] = []
        for (const image of images) {
            try {
                result.push(await this.getImage(image.name))
            } catch (error: unknown) {
                //An image whose content is not complete (pulled meanwhile, collected)
                if (!(error instanceof ContainerdImageNotFoundException) && (error as { errno?: unknown }).errno !== 'E_CONTAINERD_PLATFORM') throw error
            }
        }
        return result
    }

    /**
     * Get image
     * @param name its name, or a reference (alpine:3.20)
     */
    @Accept(DTO.String().required())
    public async getImage(name: string): Promise<ContainerdImage> {
        return await this.getObject(ContainerdImage, {
            getStore: () => this.#images,
            getContainerd: () => this,
            getRegistryOptions: () => this.registryOptions(),
            name: name
        })
    }

    /**
     * Pull image from its registry
     * @param options
     */
    @Accept(ImagePullOptions.required())
    public async pullImage(options: ImagePullOptions): Promise<ContainerdImage> {
        let platforms: Platform[] | 'all' | undefined
        if (options.platform === 'all' || (Array.isArray(options.platform) && options.platform.includes('all'))) platforms = 'all'
        else if (options.platform) platforms = (Array.isArray(options.platform) ? options.platform : [options.platform]).map(ParsePlatform)
        let name: string
        try {
            name = await this.#images.pull(options.image, {
                platforms: platforms,
                registry: this.registryOptions(options.image, options.auth),
                unpack: options.unpack,
                progress: options.progressCallback
            })
        } catch (error: unknown) {
            throw ContainerdError(error, ContainerdImagePullException)
        }
        return await this.getImage(name)
    }

    /**
     * Import images from an archive (an OCI image layout, the archive of docker save or of nerdctl save)
     * @param options
     */
    @Accept(ImageImportOptions.required())
    public async importImage(options: ImageImportOptions): Promise<ContainerdImage[]> {
        let names: string[]
        try {
            names = await this.#images.import(options.source, {name: options.name, unpack: options.unpack})
        } catch (error: unknown) {
            throw ContainerdError(error, ContainerdImageImportException)
        }
        return await Promise.all(names.map((name: string): Promise<ContainerdImage> => this.getImage(name)))
    }

    /**
     * Export images into an archive
     * @param names
     * @param options
     */
    @Accept(DTO.Array(DTO.String()).min(1).required(), ImageExportOptions.required())
    public async exportImages(names: string[], options: ImageExportOptions): Promise<void> {
        try {
            await this.#images.export(names, options.destination)
        } catch (error: unknown) {
            throw ContainerdError(error, ContainerdImageExportException)
        }
    }

    /** Containerd Container Operations **/

    /**
     * List containers
     * @param labels the labels the containers have
     */
    @Accept(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public async listContainers(labels?: Record<string, string>): Promise<ContainerdContainer[]> {
        const filters: string[] = labels && Object.keys(labels).length ? [Object.entries(labels).map(([key, value]): string => `labels."${key}"==${value}`).join(',')] : []
        const records: Message[] = await this.#containers.list(filters)
        const result: ContainerdContainer[] = []
        for (const record of records) {
            try {
                result.push(await this.getContainer(record.id))
            } catch (error: unknown) {
                //Removed meanwhile
                if (!(error instanceof ContainerdContainerNotFoundException)) throw error
            }
        }
        return result
    }

    /**
     * Get container
     * @param idOrName its identifier, its name, or a prefix of its identifier
     */
    @Accept(DTO.String().required())
    public async getContainer(idOrName: string): Promise<ContainerdContainer> {
        return await this.getObject(ContainerdContainer, {
            getStore: () => this.#containers,
            getClient: () => this.#client,
            getContainerd: () => this,
            id: idOrName
        })
    }

    /**
     * Create container
     * @param options
     */
    @Accept(ContainerCreateOptions.required())
    public async createContainer(options: ContainerCreateOptions): Promise<ContainerdContainer> {
        const mounts: ContainerMount[] = [
            ...(options.binds ?? []).map((bind): ContainerMount => ({type: 'bind', source: bind.hostPath, target: bind.containerPath, readonly: bind.rw === false, options: bind.propagation ? [bind.propagation] : undefined})),
            ...(options.tmpfs ?? []).map((tmpfs): ContainerMount => ({type: 'tmpfs', target: tmpfs.containerPath, options: [...tmpfs.size ? [`size=${tmpfs.size}`] : [], ...tmpfs.mode ? [`mode=${tmpfs.mode}`] : []]}))
        ]
        let record: Message
        try {
            record = await this.#containers.create({
                image: options.image,
                platform: options.platform ? ParsePlatform(options.platform) : undefined,
                name: options.name,
                hostname: options.hostname,
                cmd: options.cmd,
                entrypoint: options.entrypoint,
                env: options.env,
                workingDir: options.workingDir,
                user: options.user,
                labels: options.labels,
                privileged: options.privileged,
                readonlyRootfs: options.readonlyRootfs,
                capAdd: options.capabilities,
                capDrop: options.capabilitiesDrop,
                mounts: mounts,
                devices: (options.devices ?? []).map(device => ({hostPath: device.hostPath, containerPath: device.containerPath, permissions: device.cgroupPermissions})),
                network: options.network,
                pidHost: options.pidMode === 'host',
                ipcHost: options.ipcMode === 'host',
                cgroupns: options.cgroupns,
                memory: options.memoryLimit || undefined,
                memorySwap: options.memorySwap,
                cpus: options.cpus,
                cpuShares: options.cpuShares,
                cpuset: options.cpuSet?.length ? options.cpuSet.join(',') : undefined,
                pidsLimit: options.pidsLimit,
                oomKillDisable: options.OOMKillDisable,
                sysctls: options.sysctls,
                shmSize: options.shmSize,
                restart: options.restartPolicy || undefined,
                stopSignal: options.stopSignal,
                extraHosts: options.extraHosts,
                dns: options.dns
            })
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
        return await this.getContainer(record.id)
    }
}
