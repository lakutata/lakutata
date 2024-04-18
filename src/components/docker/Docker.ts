import {Component} from '../../lib/core/Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {DockerImage} from './lib/DockerImage.js'
import {DockerContainer} from './lib/DockerContainer.js'
import {platform} from 'os'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/core/DTO.js'
import Dockerode from 'dockerode'
import {DockerConnectionException} from './exceptions/DockerConnectionException.js'
import {DockerImageNotFoundException} from './exceptions/DockerImageNotFoundException.js'
import {ImagePullOptions} from './options/image/ImagePullOptions.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {createInterface} from 'node:readline'
import {DockerImagePullException} from './exceptions/DockerImagePullException.js'
import {IsAbortError} from '../../lib/helpers/IsAbortError.js'
import {ImageBuildOptions} from './options/image/ImageBuildOptions.js'
import {DockerImageBuildException} from './exceptions/DockerImageBuildException.js'
import {IDockerKeyObject} from './interfaces/IDockerKeyObject.js'
import {ImageImportOptions} from './options/image/ImageImportOptions.js'
import {DockerImageImportException} from './exceptions/DockerImageImportException.js'
import {Extract, extract as tarExtract, Headers} from 'tar-stream'
import {createReadStream} from 'node:fs'
import {PassThrough} from 'node:stream'
import {NetworkCreateOptions} from './options/network/NetworkCreateOptions.js'
import {NetworkInfo, NetworkIPAMConfig} from './types/NetworkInfo.js'
import {As} from '../../lib/helpers/As.js'
import {Time} from '../../lib/core/Time.js'
import {DockerNetworkNotFoundException} from './exceptions/DockerNetworkNotFoundException.js'
import {ContainerSettingOptions} from './options/container/ContainerSettingOptions.js'
import {ContainerBind} from './types/ContainerBind.js'
import {DockerContainerTTY} from './lib/DockerContainerTTY.js'
import {DockerPruneOptions} from './options/DockerPruneOptions.js'
import {DockerAuthOptions} from './options/auth/DockerAuthOptions.js'

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
    protected readonly key?: string | string[] | Buffer | Buffer[] | IDockerKeyObject[] | undefined

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

    readonly #internalNetworkNames: string[] = ['bridge', 'host', 'none']

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            new Promise((resolve, reject) => this.container.register(DockerImage).then(resolve).catch(reject)),
            new Promise((resolve, reject) => this.container.register(DockerContainer).then(resolve).catch(reject)),
            new Promise((resolve, reject) => this.container.register(DockerContainerTTY).then(resolve).catch(reject))
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

    /**
     * Prune unused resources
     * @param options
     */
    @Accept(DockerPruneOptions.optional())
    public async prune(options?: DockerPruneOptions): Promise<void> {
        if (!options) return await this.prune({})
        if (options.containers) await this.#instance.pruneContainers()
        if (options.images) await this.#instance.pruneImages()
        if (options.networks) await this.#instance.pruneNetworks()
        if (options.volumes) await this.#instance.pruneVolumes()
    }

    /**
     * Login to repository
     * @param options
     */
    @Accept(DockerAuthOptions.required())
    public async loginRepository(options: DockerAuthOptions): Promise<void> {
        await this.#instance.checkAuth({
            username: options.username,
            password: options.password,
            serveraddress: options.serverAddress,
            email: options.email
        })
    }

    /**
     * Check repository auth
     * @param options
     */
    @Accept(DockerAuthOptions.required())
    public async checkRepositoryAuth(options: DockerAuthOptions): Promise<boolean> {
        try {
            await this.loginRepository(options)
            return true
        } catch (e) {
            return false
        }
    }

    /** Docker Image Operations **/

    /**
     * List docker images
     */
    public async listImages(): Promise<DockerImage[]> {
        const rawImages: Dockerode.ImageInfo[] = await this.#instance.listImages()
        return await Promise.all(rawImages.map((rawImage: Dockerode.ImageInfo) => new Promise<DockerImage>((resolve, reject) => this.container.get(DockerImage, {
            id: rawImage.Id,
            getDockerode: () => this.#instance,
            getDocker: () => this
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
    @Accept(ImageBuildOptions.required())
    public async buildImage(options: ImageBuildOptions): Promise<DockerImage> {
        const buildContext: Dockerode.ImageBuildContext = {
            context: options.workdir,
            src: options.files
        }
        const buildOptions: Dockerode.ImageBuildOptions = {
            dockerfile: options.dockerfile,
            t: options.repoTag,
            remote: options.remote,
            q: options.quite,
            nocache: options.nocache,
            rm: options.rm,
            forcerm: options.forcerm,
            platform: options.platform,
            target: options.target,
            shmsize: options.shmsize,
            buildargs: options.buildargs,
            abortSignal: this.#abortController.signal
        }
        try {
            const readableStream: NodeJS.ReadableStream = await this.#instance.buildImage(buildContext, buildOptions)
            return new Promise<DockerImage>((resolve, reject) => {
                let imageId: string | undefined = undefined
                let buildImageException: DockerImageBuildException | undefined = undefined
                createInterface({input: readableStream})
                    .on('line', (line: string) => {
                        const outputObject: Record<string, any> = JSON.parse(line)
                        if (outputObject.error) buildImageException = new DockerImageBuildException(outputObject.error)
                        if (outputObject.aux) imageId = outputObject.aux.ID
                        if (options.outputCallback) options.outputCallback(outputObject)
                    })
                    .once('close', () => {
                        if (buildImageException) return reject(buildImageException)
                        if (!imageId) return reject(new DockerImageBuildException('Build image failed'))
                        return this.getImage(imageId).then(resolve).catch(reject)
                    })
            })
        } catch (e) {
            if (!IsAbortError(e)) throw e
            return undefined as any
        }
    }

    /**
     * Import docker image from .tar file
     */
    @Accept(ImageImportOptions.required())
    public async importImage(options: ImageImportOptions): Promise<DockerImage> {
        const imageSourceReadableStream: NodeJS.ReadableStream = typeof options.source === 'string' ? createReadStream(options.source) : options.source
        const tarExtractPassThrough: PassThrough = new PassThrough()
        const loadImagePassThrough: PassThrough = new PassThrough()
        imageSourceReadableStream.pipe(tarExtractPassThrough)
        imageSourceReadableStream.pipe(loadImagePassThrough)
        const tarExtractor: Extract = tarExtract()
        let imageId: string
        tarExtractor
            .on('entry', (header: Headers, stream: PassThrough, next: Function) => {
                if (header.name === 'manifest.json') {
                    createInterface({input: stream})
                        .on('line', manifestLine => {
                            const manifestObject: Record<string, any> = JSON.parse(manifestLine)[0]
                            imageId = manifestObject.Config.toString().replace('blobs/', '').replace('/', ':')
                        })
                }
                stream.on('end', () => next())
                stream.resume()
            })
        tarExtractPassThrough.pipe(tarExtractor)
        const readableStream: NodeJS.ReadableStream = await this.#instance.loadImage(loadImagePassThrough, {quiet: options.quiet})
        return new Promise<DockerImage>((resolve, reject) => {
            let importImageException: DockerImageImportException | undefined = undefined
            createInterface({input: readableStream})
                .on('line', (line: string) => {
                    const outputObject: Record<string, any> = JSON.parse(line)
                    if (outputObject.error) importImageException = new DockerImageImportException(outputObject.error)
                })
                .once('close', () => {
                    if (importImageException) return reject(importImageException)
                    return this.getImage(imageId).then(resolve).catch(reject)
                })
        })
    }

    /**
     * Get docker image
     * @param repoTagOrId
     */
    @Accept(DTO.String().required())
    public async getImage(repoTagOrId: string): Promise<DockerImage> {
        const images: DockerImage[] = await this.listImages()
        const result: DockerImage[] = images
            .filter((image: DockerImage): boolean => {
                if (image.id === repoTagOrId) return true
                return image.repoTags.includes(repoTagOrId)
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
    public async listContainers(): Promise<DockerContainer[]> {
        try {
            const rawContainers: Dockerode.ContainerInfo[] = await this.#instance.listContainers({
                all: true,
                abortSignal: this.#abortController.signal
            })
            return await Promise.all(rawContainers.map((containerInfo: Dockerode.ContainerInfo) => new Promise<DockerContainer>((resolve, reject) => this.getContainer(containerInfo.Id).then(resolve).catch(reject))))
        } catch (e) {
            if (!IsAbortError(e)) throw e
            return []
        }
    }

    /**
     * Get docker container
     * @param id
     */
    @Accept(DTO.String().required())
    public async getContainer(id: string): Promise<DockerContainer> {
        return await this.getObject(DockerContainer, {
            getDockerode: () => this.#instance,
            getDocker: () => this,
            id: id
        })
    }

    /**
     * Create container
     * @param imageId
     * @param platform
     * @param options
     */
    @Accept(DTO.String().required(), DTO.String().required(), ContainerSettingOptions.required())
    public async createContainer(imageId: string, platform: string, options: ContainerSettingOptions): Promise<DockerContainer> {
        const portBindingMap: Map<string, { HostPort: string }[]> = new Map()
        options.ports?.forEach(port => {
            const portBindingMapKey: string = `${port.port}/${port.type}`
            if (!portBindingMap.has(portBindingMapKey)) portBindingMap.set(portBindingMapKey, [])
            const hostPorts = portBindingMap.get(portBindingMapKey)!
            port.hostPorts.forEach((hostPort: number): void => {
                hostPorts.push({HostPort: hostPort.toString()})
            })
            portBindingMap.set(portBindingMapKey, hostPorts)
        })
        const portBindings: Record<string, ({ HostPort: string }[]) | null> = {}
        portBindingMap.forEach((hostPorts: { HostPort: string }[], portWithType: string) => {
            portBindings[portWithType] = hostPorts.length ? hostPorts : null
        })
        const binds: string[] = []
        options.binds?.forEach((bind: ContainerBind) => binds.push(`${bind.hostPath}:${bind.containerPath}:${bind.rw ? 'rw' : 'ro'}`))
        const devices: {
            PathOnHost: string
            PathInContainer: string
            CgroupPermissions: string
        }[] = []
        options.devices?.forEach(device => devices.push({
            PathOnHost: device.hostPath,
            PathInContainer: device.containerPath,
            CgroupPermissions: device.cgroupPermissions!
        }))
        const networkConfigMapping: Record<string, Dockerode.EndpointSettings> = {}
        options.networks?.forEach(network => {
            networkConfigMapping[network.networkName!] = this.#internalNetworkNames.includes(network.networkName!)
                ? {}
                : {
                    IPAMConfig: {
                        IPv4Address: network.ip ? network.ip : undefined,
                        IPv6Address: network.ipv6 ? network.ipv6 : undefined
                    }
                }
        })
        const containerEnvRecord: Record<string, string> = options.env ? options.env : {}
        const rawContainer: Dockerode.Container = await this.#instance.createContainer({
            Image: imageId,
            name: options.name,
            platform: platform,
            Hostname: options.hostname,
            Tty: options.tty,
            Env: Object.keys(containerEnvRecord).map(envKey => `${envKey}=${containerEnvRecord[envKey]}`),
            HostConfig: {
                Memory: options.memoryLimit,
                CpusetCpus: options.cpuSet ? options.cpuSet.join(',') : undefined,
                Privileged: options.privileged,
                RestartPolicy: options.restartPolicy ? {Name: As<string>(options.restartPolicy)} : undefined,
                OomKillDisable: options.OOMKillDisable,
                PortBindings: portBindings,
                Binds: binds,
                Devices: devices,
                CapAdd: options.capabilities,
                Cgroup: options.cgroup,
                CgroupParent: options.cgroupParent,
                PidMode: options.pidMode
            },
            NetworkingConfig: {
                EndpointsConfig: networkConfigMapping
            }
        })
        return await this.getContainer(rawContainer.id)
    }

    /** Docker Network Operations **/

    /**
     * Create docker network
     * @param options
     */
    @Accept(NetworkCreateOptions.required())
    public async createNetwork(options: NetworkCreateOptions): Promise<NetworkInfo> {
        const network: Dockerode.Network = await this.#instance.createNetwork({
            Name: options.name,
            Driver: options.driver,
            Internal: options.internal,
            Options: options.options,
            IPAM: {
                Driver: 'default',
                Options: {},
                Config: options.NetworkIPAMConfigs.map((config: NetworkIPAMConfig): Record<string, any> => ({
                    Subnet: config.subnet,
                    IPRange: config.range,
                    Gateway: config.gateway
                }))
            },
            EnableIPv6: options.enableIPv6
        })
        return await this.getNetwork(network.id)
    }

    /**
     * Remove docker network
     * @param id
     */
    @Accept(DTO.String().required())
    public async removeNetwork(id: string): Promise<void> {
        const network: NetworkInfo = await this.getNetwork(id)
        await this.#instance.getNetwork(network.id).remove()
    }

    /**
     * List docker networks
     */
    public async listNetworks(): Promise<NetworkInfo[]> {
        try {
            const rawNetworks: Dockerode.NetworkInspectInfo[] = await this.#instance.listNetworks({abortSignal: this.#abortController.signal})
            return rawNetworks.map((rawNetwork: Dockerode.NetworkInspectInfo): NetworkInfo => ({
                id: rawNetwork.Id,
                name: rawNetwork.Name,
                driver: As<'bridge' | 'ipvlan' | 'macvlan'>(rawNetwork.Driver),
                reserved: ['bridge', 'host', 'none'].includes(rawNetwork.Name),
                internal: rawNetwork.Internal,
                enableIPv6: rawNetwork.EnableIPv6,
                IPAMConfigs: rawNetwork.IPAM?.Config
                    ? rawNetwork.IPAM.Config.map((item: Record<string, string>): NetworkIPAMConfig => ({
                        subnet: item.Subnet,
                        range: item.IPRange,
                        gateway: item.Gateway
                    }))
                    : [],
                createdAt: new Time(rawNetwork.Created)
            }))
        } catch (e) {
            if (!IsAbortError(e)) throw e
            return []
        }
    }

    /**
     * Get docker network info
     * @param id
     */
    @Accept(DTO.String().required())
    public async getNetwork(id: string): Promise<NetworkInfo> {
        const networks: NetworkInfo[] = await this.listNetworks()
        const network: NetworkInfo | undefined = networks.find((network: NetworkInfo): boolean => network.id === id)
        if (!network) throw new DockerNetworkNotFoundException('Network {0} not found', [id])
        return network
    }
}
