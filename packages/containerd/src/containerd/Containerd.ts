import {Component, DTO} from '@lakutata/core'
import {Singleton, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {ContainerdClient, type ContainerdEvent} from '../client/ContainerdClient.js'
import {ImageStore} from '../client/ImageStore.js'
import {ContainerStore, type ContainerMount} from '../client/ContainerStore.js'
import {FormatPlatform, HostPlatform, ParsePlatform, SupportedPlatforms, type Platform} from '../client/Platforms.js'
import {ParseReference} from '../client/Reference.js'
import {DEFAULT_NETWORK, NetworkStore, type CNINetwork, type PortMapping} from '../client/Networks.js'
import {GRPCConnection} from '../client/GRPC.js'
import {BuildKitBuild, BuildKitPlatforms, BuildKitVersion} from '../client/BuildKit.js'
import {mkdir, rm} from 'node:fs/promises'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
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
import {ContainerdNetworkNotFoundException} from './exceptions/ContainerdNetworkNotFoundException.js'
import {ContainerdNetworkConflictException} from './exceptions/ContainerdNetworkConflictException.js'
import {NetworkCreateOptions} from './options/network/NetworkCreateOptions.js'
import {ImageBuildOptions} from './options/image/ImageBuildOptions.js'
import {ContainerdImageBuildException} from './exceptions/ContainerdImageBuildException.js'
import type {ContainerdNetworkInfo} from './types/ContainerdNetworkInfo.js'

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
     * The directory of the configurations of the networks of CNI
     */
    @Configurable(DTO.String().optional().default('/etc/cni/net.d'))
    protected readonly cniConfigPath: string

    /**
     * The directories of the plugins of CNI (the ones which exist are used)
     */
    @Configurable(DTO.Array(DTO.String()).optional().default(['/opt/cni/bin', '/usr/lib/cni', '/usr/libexec/cni']))
    protected readonly cniPath: string[]

    /**
     * The address of BuildKit building the images: its socket (unix:///run/buildkit/buildkitd.sock), or a remote one
     * (tcp://host:1234)
     */
    @Configurable(DTO.String().pattern(/^(\/|unix:\/\/\/|tcp:\/\/)/).optional().default('unix:///run/buildkit/buildkitd.sock'))
    protected readonly buildkitAddress: string

    /**
     * The TLS of a remote BuildKit: the authority of its certificate, the certificate and the key of the client (PEM)
     */
    @Configurable(DTO.Object({
        ca: DTO.Alternatives(DTO.String(), DTO.Binary()).optional(),
        cert: DTO.Alternatives(DTO.String(), DTO.Binary()).optional(),
        key: DTO.Alternatives(DTO.String(), DTO.Binary()).optional(),
        servername: DTO.String().optional()
    }).optional())
    protected readonly buildkitTLS?: { ca?: string | Buffer, cert?: string | Buffer, key?: string | Buffer, servername?: string }

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

    #networks: NetworkStore

    #buildkit: GRPCConnection

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
        this.#images = new ImageStore(this.#client, this.snapshotter, path.join(this.dataRoot, 'tmp'))
        this.#buildkit = new GRPCConnection(this.buildkitAddress, this.buildkitTLS)
        this.#networks = new NetworkStore(this.cniConfigPath, this.cniPath)
        this.#containers = new ContainerStore(this.#client, this.#images, this.#networks, {
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
        this.#buildkit?.close()
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
     * The version of BuildKit
     */
    public async buildkitVersion(): Promise<{ package: string, version: string, revision: string }> {
        try {
            return await BuildKitVersion(this.#buildkit)
        } catch (error: unknown) {
            throw new ContainerdImageBuildException(`Cannot connect to BuildKit (${this.buildkitAddress}): ${(error as Error).message}`)
        }
    }

    /**
     * The platforms BuildKit builds (its workers, the emulators of its machine)
     */
    public async buildkitPlatforms(): Promise<string[]> {
        try {
            return (await BuildKitPlatforms(this.#buildkit)).map(FormatPlatform)
        } catch (error: unknown) {
            throw new ContainerdImageBuildException(`Cannot connect to BuildKit (${this.buildkitAddress}): ${(error as Error).message}`)
        }
    }

    /**
     * Build an image with BuildKit (local or remote): its context and its Dockerfile sent by the session of BuildKit,
     * the image imported into containerd (and pushed)
     * @param options
     */
    @Accept(ImageBuildOptions.required())
    public async buildImage(options: ImageBuildOptions): Promise<ContainerdImage> {
        const name: string = ParseReference(options.repoTag).name
        const platforms: Platform[] = options.platform ? (Array.isArray(options.platform) ? options.platform : [options.platform]).map(ParsePlatform) : [HostPlatform()]
        const temporary: string = path.join(this.dataRoot, 'tmp')
        await mkdir(temporary, {recursive: true})
        const archive: string = path.join(temporary, `lakutata-build-${randomBytes(8).toString('hex')}.tar`)
        const registry: RegistryOptions = this.registryOptions(options.repoTag, options.auth)
        try {
            await BuildKitBuild(this.#buildkit, {
                context: options.workdir,
                dockerfile: options.dockerfile,
                target: options.target || undefined,
                buildArgs: options.buildargs,
                labels: options.labels,
                platforms: platforms,
                noCache: options.nocache,
                pull: options.pull,
                name: name,
                output: archive,
                credentials: (host: string): RegistryCredentials | undefined => registry.credentials?.[host],
                progress: options.outputCallback,
                signal: this.#abortController.signal
            })
            await this.#images.import(archive, {name: name})
        } catch (error: unknown) {
            throw new ContainerdImageBuildException((error as Error).message)
        } finally {
            await rm(archive, {force: true})
        }
        const image: ContainerdImage = await this.getImage(name)
        if (options.push) await image.push({auth: options.auth})
        return image
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

    /** Containerd Network Operations **/

    /**
     * The information of a network
     * @param network
     * @protected
     */
    protected networkInfo(network: CNINetwork): ContainerdNetworkInfo {
        const main: Record<string, any> = network.plugins[0] ?? {}
        return {
            id: network.id,
            name: network.name,
            driver: network.driver,
            reserved: !network.managed || network.labels['nerdctl/default-network'] === 'true',
            internal: network.driver === 'bridge' && main.isGateway === false && main.ipMasq === false,
            subnets: network.subnets,
            gateways: network.gateways,
            labels: network.labels,
            file: network.file
        }
    }

    /**
     * List networks: host, none, and the ones of CNI (the default one of nerdctl, bridge, created once a container asks
     * it)
     */
    public async listNetworks(): Promise<ContainerdNetworkInfo[]> {
        const system: ContainerdNetworkInfo[] = ['host', 'none'].map((name: string): ContainerdNetworkInfo => ({id: name, name: name, driver: name, reserved: true, internal: name === 'none', subnets: [], gateways: [], labels: {}}))
        return [...system, ...(await this.#networks.list()).map((network: CNINetwork): ContainerdNetworkInfo => this.networkInfo(network))]
    }

    /**
     * Get network
     * @param nameOrId its name, its identifier or a prefix of it
     */
    @Accept(DTO.String().required())
    public async getNetwork(nameOrId: string): Promise<ContainerdNetworkInfo> {
        if (nameOrId === 'host' || nameOrId === 'none') return (await this.listNetworks()).find((network: ContainerdNetworkInfo): boolean => network.name === nameOrId)!
        const network: CNINetwork | undefined = await this.#networks.get(nameOrId)
        if (!network) throw new ContainerdNetworkNotFoundException(`The network ${nameOrId} does not exist`)
        return this.networkInfo(network)
    }

    /**
     * Create a network of CNI (its configuration list nerdctl-<name>.conflist, the one of nerdctl network create)
     * @param options
     */
    @Accept(NetworkCreateOptions.required())
    public async createNetwork(options: NetworkCreateOptions): Promise<ContainerdNetworkInfo> {
        try {
            return this.networkInfo(await this.#networks.create(options))
        } catch (error: unknown) {
            if ((error as { code?: unknown }).code === 'CONFLICT') throw new ContainerdNetworkConflictException((error as Error).message)
            throw error
        }
    }

    /**
     * Remove a network (one of nerdctl, which no container uses)
     * @param nameOrId
     */
    @Accept(DTO.String().required())
    public async removeNetwork(nameOrId: string): Promise<void> {
        const network: CNINetwork | undefined = nameOrId === DEFAULT_NETWORK ? (await this.#networks.list()).find((item: CNINetwork): boolean => item.name === nameOrId) : await this.#networks.get(nameOrId)
        if (!network) throw new ContainerdNetworkNotFoundException(`The network ${nameOrId} does not exist`)
        const users: string[] = (await this.#containers.list())
            .filter((record: Message): boolean => {
                try {
                    return (JSON.parse(record.labels?.['nerdctl/networks'] ?? '[]') as string[]).includes(network.name)
                } catch {
                    return false
                }
            })
            .map((record: Message): string => ContainerStore.Name(record))
        if (users.length) throw new ContainerdNetworkConflictException(`The network ${network.name} is used by the containers ${users.join(', ')}`)
        try {
            await this.#networks.remove(network)
        } catch (error: unknown) {
            throw new ContainerdNetworkConflictException((error as Error).message)
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
        const ports: PortMapping[] = (options.ports ?? []).flatMap((port): PortMapping[] => port.hostPorts.map((hostPort: number): PortMapping => ({hostPort: hostPort, containerPort: port.port, protocol: port.type ?? 'tcp', hostIP: port.hostIP})))
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
                network: options.networks?.length ? options.networks.map((network): { name: string, ip?: string } => ({name: network.networkName, ip: network.ip || undefined})) : options.network,
                ports: ports,
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
