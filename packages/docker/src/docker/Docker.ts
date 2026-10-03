import {Component, DTO} from '@lakutata/core'
import {Singleton, Configurable} from '@lakutata/core/decorator/di'
import {DockerImage} from './lib/DockerImage.js'
import {DockerContainer} from './lib/DockerContainer.js'
import {DockerConnectionException} from './exceptions/DockerConnectionException.js'
import {DockerImageNotFoundException} from './exceptions/DockerImageNotFoundException.js'
import {ImagePullOptions} from './options/image/ImagePullOptions.js'
import {Accept} from '@lakutata/core/decorator/dto'
import {DockerImagePullException} from './exceptions/DockerImagePullException.js'
import {IsAbortError, As} from '@lakutata/utils'
import {ImageBuildOptions} from './options/image/ImageBuildOptions.js'
import {DockerImageBuildException} from './exceptions/DockerImageBuildException.js'
import {IDockerKeyObject} from './interfaces/IDockerKeyObject.js'
import {ImageImportOptions} from './options/image/ImageImportOptions.js'
import {DockerImageImportException} from './exceptions/DockerImageImportException.js'
import {Extract, extract as tarExtract, type Header} from 'tar-stream'
import {createReadStream} from 'node:fs'
import {PassThrough} from 'node:stream'
import {NetworkCreateOptions} from './options/network/NetworkCreateOptions.js'
import {NetworkInfo, NetworkIPAMConfig} from './types/NetworkInfo.js'
import {Time} from '@lakutata/utils/Time'
import {DockerNetworkNotFoundException} from './exceptions/DockerNetworkNotFoundException.js'
import {ContainerSettingOptions} from './options/container/ContainerSettingOptions.js'
import {ContainerBind} from './types/ContainerBind.js'
import {DockerContainerTTY} from './lib/DockerContainerTTY.js'
import {DockerPruneOptions} from './options/DockerPruneOptions.js'
import {DockerAuthOptions} from './options/auth/DockerAuthOptions.js'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {DockerClient, type DockerRegistryAuth} from '../client/DockerClient.js'
import {PackBuildContext} from '../client/BuildContext.js'
import {BuildKitProgress, DecodeBuildKitStatus} from '../client/BuildKitProgress.js'
import {FollowProgress} from '../client/DockerStreams.js'
import {ParseBaseImages} from './lib/ParseBaseImages.js'
import {type DeviceMapping} from '../client/types/DeviceMapping.js'
import {type IdResponse} from '../client/types/IdResponse.js'
import {type PortBinding} from '../client/types/PortBinding.js'

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

    #client: DockerClient

    #abortController: AbortController = new AbortController()

    readonly #internalNetworkNames: string[] = ['bridge', 'host', 'none']

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            this.container.register(DockerImage),
            this.container.register(DockerContainer),
            this.container.register(DockerContainerTTY)
        ])
        //Without a socket nor a host, the Docker of the environment (DOCKER_HOST, the socket of Docker Desktop or of the
        //system, the named pipe of Windows)
        this.#client = new DockerClient(this.socketPath || this.host ? {
            socketPath: this.socketPath,
            host: this.host,
            port: this.port,
            username: this.username,
            headers: this.headers,
            ca: this.ca,
            cert: this.cert,
            key: this.key as any,
            protocol: this.protocol,
            timeout: this.timeout,
            version: this.version,
            sshAuthAgent: this.sshAuthAgent
        } : {version: this.version})
        try {
            await this.#client.ping()
            //The API version of the requests: the newest one supported by the daemon and this client
            await this.#client.connection.negotiate()
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
        this.#client?.close()
    }

    /** Docker Common Operations **/

    /**
     * Prune unused resources
     * @param options
     */
    @Accept(DockerPruneOptions.optional())
    public async prune(options?: DockerPruneOptions): Promise<void> {
        if (!options) return await this.prune({})
        if (options.containers) await this.#client.pruneContainers()
        if (options.images) await this.#client.pruneImages()
        if (options.networks) await this.#client.pruneNetworks()
        if (options.volumes) await this.#client.pruneVolumes()
    }

    /**
     * Login to repository
     * @param options
     */
    @Accept(DockerAuthOptions.required())
    public async loginRepository(options: DockerAuthOptions): Promise<void> {
        await this.#client.checkAuth({
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
        const rawImages: Record<string, any>[] = await this.#client.listImages()

        return await Promise.all(rawImages.map((rawImage: Record<string, any>) => {
            return this.container.get(DockerImage, {
                id: rawImage.Id,
                getClient: () => this.#client,
                getDocker: () => this
            })
        }))
    }

    /**
     * Pull docker image from repository
     */
    @Accept(ImagePullOptions.required())
    public async pullImage(options: ImagePullOptions): Promise<DockerImage> {
        const auth: DockerRegistryAuth | undefined = options.auth ? {
            username: options.auth.username,
            password: options.auth.password,
            serveraddress: options.auth.serverAddress,
            identitytoken: options.auth.identityToken,
            registrytoken: options.auth.registryToken
        } : undefined
        const tag: string = options.tag ? options.tag : 'latest'
        try {
            const readableStream: NodeJS.ReadableStream = await this.#client.pullImage({fromImage: options.repo, tag: tag, platform: options.platform}, auth, this.#abortController.signal)
            let pullError: string | undefined
            await FollowProgress(readableStream, (outputObject: Record<string, any>): void => {
                if (options.outputCallback) options.outputCallback(outputObject)
                if (outputObject.error && !pullError) pullError = outputObject.error
            })
            if (pullError) throw new Error(pullError)
            return await this.getImage(`${options.repo}:${tag}`)
        } catch (e: any) {
            if (!IsAbortError(e)) throw new DockerImagePullException(e.message)
            return undefined as any
        }
    }

    /**
     * Build docker image: the context is the files of the workdir (with the directories, their content), without the
     * ones excluded by its .dockerignore; the build is done by BuildKit, its progress is given to the output callback
     * as the lines of "docker build --progress=plain" ({id: 'moby.buildkit.trace', stream: '#2 [1/2] FROM alpine'})
     */
    @Accept(ImageBuildOptions.required())
    public async buildImage(options: ImageBuildOptions): Promise<DockerImage> {
        const dockerfile: string = options.dockerfile ? options.dockerfile : 'Dockerfile'
        const auth: DockerRegistryAuth | undefined = options.auth ? {
            username: options.auth.username,
            password: options.auth.password,
            serveraddress: options.auth.serverAddress,
            email: options.auth.email
        } : undefined
        try {
            //The base images of a private registry are pulled with the credentials (BuildKit is not given them)
            if (auth) {
                const content: string = await readFile(path.resolve(options.workdir, dockerfile), {encoding: 'utf-8'})
                for (const baseImage of ParseBaseImages(content, options.buildargs)) {
                    const [repo, tag] = [baseImage.replace(/:([^:/@]+)$/, ''), /:([^:/@]+)$/.exec(baseImage)?.[1]]
                    await this.pullImage({repo: repo, tag: tag, platform: options.platform, auth: options.auth, outputCallback: options.outputCallback})
                }
            }
            const context: NodeJS.ReadableStream = PackBuildContext({directory: options.workdir, entries: options.files, always: [dockerfile]})
            const registryConfig: Record<string, DockerRegistryAuth> | undefined = auth ? {[auth.serveraddress ?? 'https://index.docker.io/v1/']: auth} : undefined
            const readableStream: NodeJS.ReadableStream = await this.#client.buildImage(context, {
                dockerfile: dockerfile,
                t: options.repoTag ? options.repoTag : `unnamed_img_${Date.now().toString(16)}${Math.floor(Math.random() * 255).toString(16).padStart(2, '0')}`,
                remote: options.remote,
                q: options.quite,
                nocache: options.nocache,
                rm: options.rm,
                forcerm: options.forcerm,
                platform: options.platform,
                target: options.target,
                shmsize: options.shmsize,
                buildargs: options.buildargs,
                version: '2'
            }, registryConfig, this.#abortController.signal)
            const progress: BuildKitProgress = new BuildKitProgress()
            let imageId: string | undefined
            let buildError: string | undefined
            await FollowProgress(readableStream, (outputObject: Record<string, any>): void => {
                if (outputObject.error && !buildError) buildError = outputObject.error
                if (outputObject.id === 'moby.buildkit.trace' && typeof outputObject.aux === 'string') {
                    for (const line of progress.lines(DecodeBuildKitStatus(outputObject.aux))) options.outputCallback?.({id: outputObject.id, stream: line})
                    return
                }
                if (outputObject.aux && typeof outputObject.aux === 'object' && outputObject.aux.ID) imageId = outputObject.aux.ID
                options.outputCallback?.(outputObject)
            })
            if (buildError) throw new DockerImageBuildException(buildError)
            if (!imageId) throw new DockerImageBuildException('Build image failed')
            return await this.getImage(imageId)
        } catch (e: any) {
            if (IsAbortError(e)) return undefined as any
            if (e instanceof DockerImageBuildException) throw e
            throw new DockerImageBuildException(e.message)
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
        let manifestImageId: string | undefined
        tarExtractor
            //The types of tar-stream are its own (3.2): the stream of the entry is the one of streamx
            .on('entry', (header: Header, stream, next): void => {
                if (header.name === 'manifest.json') {
                    const chunks: Buffer[] = []
                    stream.on('data', (chunk: unknown): unknown => chunks.push(chunk as Buffer))
                    stream.once('end', (): void => {
                        try {
                            const manifestObject: Record<string, any> = JSON.parse(Buffer.concat(chunks).toString())[0]
                            manifestImageId = manifestObject.Config.toString().replace('blobs/', '').replace('.json', '').replace('/', ':')
                        } catch {
                            //Not a manifest of docker save
                        }
                    })
                }
                stream.on('end', () => next())
                stream.resume()
            })
        tarExtractPassThrough.pipe(tarExtractor)
        const readableStream: NodeJS.ReadableStream = await this.#client.loadImage(loadImagePassThrough, {quiet: options.quiet})
        let importError: string | undefined
        let loadedImage: string | undefined
        await FollowProgress(readableStream, (outputObject: Record<string, any>): void => {
            if (outputObject.error && !importError) importError = outputObject.error
            //"Loaded image ID: sha256:…" or "Loaded image: repo:tag"
            const loaded: RegExpExecArray | null = /Loaded image(?: ID)?: (\S+)/.exec(outputObject.stream ?? '')
            if (loaded && !loadedImage) loadedImage = loaded[1]
        })
        if (importError) throw new DockerImageImportException(importError)
        const image: string | undefined = loadedImage ?? manifestImageId
        if (!image) throw new DockerImageImportException('The imported image is unknown')
        return await this.getImage(image)
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
            const rawContainers: Record<string, any>[] = await this.#client.listContainers({all: true}, this.#abortController.signal)
            return await Promise.all(rawContainers.map((containerInfo: Record<string, any>): Promise<DockerContainer> => this.getContainer(containerInfo.Id)))
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
            getClient: () => this.#client,
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
    public async createContainer(imageId: string, options: ContainerSettingOptions): Promise<DockerContainer>
    public async createContainer(imageId: string, platform: string, options: ContainerSettingOptions): Promise<DockerContainer>
    @Accept(DTO.String().required(), DTO.Alternatives(DTO.String(), ContainerSettingOptions.required()).required(), ContainerSettingOptions.optional())
    public async createContainer(imageId: string, platformOrOptions: string | ContainerSettingOptions, settingOptions?: ContainerSettingOptions): Promise<DockerContainer> {
        //The platform is optional: the one of the image by default
        const platform: string | undefined = typeof platformOrOptions === 'string' ? platformOrOptions : undefined
        const options: ContainerSettingOptions = typeof platformOrOptions === 'string' ? settingOptions ?? {} : platformOrOptions
        const portBindingMap: Map<string, PortBinding[]> = new Map()
        options.ports?.forEach(port => {
            const portBindingMapKey: string = `${port.port}/${port.type}`
            if (!portBindingMap.has(portBindingMapKey)) portBindingMap.set(portBindingMapKey, [])
            const hostPorts = portBindingMap.get(portBindingMapKey)!
            port.hostPorts.forEach((hostPort: number): void => {
                hostPorts.push({HostPort: hostPort.toString()})
            })
            portBindingMap.set(portBindingMapKey, hostPorts)
        })
        const portBindings: Record<string, PortBinding[] | null> = {}
        portBindingMap.forEach((hostPorts: PortBinding[], portWithType: string) => {
            portBindings[portWithType] = hostPorts.length ? hostPorts : null
        })
        const binds: string[] = []
        options.binds?.forEach((bind: ContainerBind) => binds.push(`${bind.hostPath}:${bind.containerPath}:${bind.rw ? 'rw' : 'ro'}`))
        const devices: DeviceMapping[] = []
        options.devices?.forEach(device => devices.push({
            PathOnHost: device.hostPath,
            PathInContainer: device.containerPath,
            CgroupPermissions: device.cgroupPermissions!
        }))
        const networkConfigMapping: Record<string, Record<string, unknown>> = {}
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
        const rawContainer: IdResponse = await this.#client.createContainer({
            Image: imageId,
            Hostname: options.hostname,
            Tty: options.tty,
            Env: Object.keys(containerEnvRecord).map(envKey => `${envKey}=${containerEnvRecord[envKey]}`),
            Cmd: options.cmd,
            Entrypoint: options.entrypoint,
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
        }, {name: options.name, platform: platform})
        return await this.getContainer(rawContainer.Id)
    }

    /** Docker Network Operations **/

    /**
     * Create docker network
     * @param options
     */
    @Accept(NetworkCreateOptions.required())
    public async createNetwork(options: NetworkCreateOptions): Promise<NetworkInfo> {
        const network: IdResponse = await this.#client.createNetwork({
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
        return await this.getNetwork(network.Id)
    }

    /**
     * Remove docker network
     * @param id
     */
    @Accept(DTO.String().required())
    public async removeNetwork(id: string): Promise<void> {
        const network: NetworkInfo = await this.getNetwork(id)
        await this.#client.removeNetwork(network.id)
    }

    /**
     * List docker networks
     */
    public async listNetworks(): Promise<NetworkInfo[]> {
        try {
            const rawNetworks: Record<string, any>[] = await this.#client.listNetworks(undefined, this.#abortController.signal)
            return rawNetworks.map((rawNetwork: Record<string, any>): NetworkInfo => ({
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
