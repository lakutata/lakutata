import {Component, DTO} from '@lakutata/core'
import {Singleton, Configurable} from '@lakutata/core/decorator/di'
import {DockerImage} from './lib/DockerImage.js'
import {DockerContainer} from './lib/DockerContainer.js'
import {DockerConnectionException} from './exceptions/DockerConnectionException.js'
import {DockerImageNotFoundException} from './exceptions/DockerImageNotFoundException.js'
import {ImagePullOptions} from './options/image/ImagePullOptions.js'
import {Accept} from '@lakutata/core/decorator/dto'
import {DockerImagePullException} from './exceptions/DockerImagePullException.js'
import {isAbortError} from '@lakutata/utils'
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
import {ContainerSettingOptions} from './options/container/ContainerSettingOptions.js'
import {DockerContainerTTY} from './lib/DockerContainerTTY.js'
import {DockerPruneOptions} from './options/DockerPruneOptions.js'
import {DockerAuthOptions} from './options/auth/DockerAuthOptions.js'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {DockerClient, type DockerRegistryAuth} from '../client/DockerClient.js'
import {packBuildContext} from '../client/BuildContext.js'
import {BuildKitProgress, decodeBuildKitStatus} from '../client/BuildKitProgress.js'
import {followProgress} from '../client/DockerStreams.js'
import {parseBaseImages} from './lib/ParseBaseImages.js'
import {type IdResponse} from '../client/types/IdResponse.js'
import {DockerContainerNotFoundException} from './exceptions/DockerContainerNotFoundException.js'
import {registryAuth} from './lib/RegistryAuth.js'
import {engineBinds, engineDevices, engineEndpoints, enginePortBindings, engineRestartPolicy} from './lib/EngineSettings.js'

/**
 * The Docker component: drives a Docker daemon over the Docker Engine API, to pull, build, import, export, tag and push
 * images, to create, run and manage containers (exec, TTYs, logs, stats, commit, archives) and to manage networks.
 * Register it in the `components` of an application (`{class: Docker}`, or the result of one of the
 * `buildDocker*ConnectionOptions` functions) and get it with `getObject()` or `@Inject`; it is a singleton.
 *
 * Without `socketPath` nor `host`, it connects to the Docker of the environment: `DOCKER_HOST` (with
 * `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH` and `DOCKER_CLIENT_TIMEOUT`), else the named pipe `//./pipe/docker_engine` on
 * Windows, the socket of Docker Desktop (`~/.docker/run/docker.sock`) when it exists, or `/var/run/docker.sock`; the
 * other options given (`timeout`, `headers`, `version`…) apply over the environment's. No Docker CLI is needed locally
 * (the SSH connections need it on the remote host).
 *
 * When it is created, the component pings the daemon and negotiates the API version (the newest one supported by both,
 * from 1.41 to 1.56): a daemon which cannot be reached fails its creation with {@link DockerConnectionException}.
 * Afterwards, a daemon which cannot be reached rejects the calls with the network error of Node.js (`ECONNREFUSED`,
 * `ENOENT`…). A request the daemon refuses rejects with the exception of what is missing
 * ({@link DockerContainerNotFoundException}, {@link DockerImageNotFoundException},
 * {@link DockerNetworkNotFoundException}), else with a {@link DockerRequestException}, whose `statusCode` is the HTTP
 * status and whose message is the daemon's. The pulls, builds, imports and pushes wrap their failures in their own
 * exceptions ({@link DockerImagePullException}…).
 *
 * When the component is destroyed (the application stopping), the pulls and builds in progress are aborted (they reject
 * with their exception), the listings in progress resolve with an empty list, and its connections are closed.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'
 *
 * Application
 *     .run(() => ({
 *         id: 'docker.app',
 *         name: 'Docker',
 *         components: {
 *             //The Docker of the environment: DOCKER_HOST, else the local socket
 *             docker: {class: Docker}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const docker: Docker = await app.getObject('docker')
 *         const image: DockerImage = await docker.pullImage({repo: 'alpine', tag: '3.20'})
 *         //Created, then started
 *         const container: DockerContainer = await image.run({name: 'hello', cmd: ['sleep', '60']})
 *         console.log((await container.exec({cmd: ['echo', 'hello']})).stdout)
 *         await container.remove({force: true})
 *     })
 * ```
 */
@Singleton()
export class Docker extends Component {

    /**
     * The path of the daemon's Unix socket (`/var/run/docker.sock`), or of its named pipe on Windows
     * (`//./pipe/docker_engine`). When set, `host` and `port` are ignored.
     * @default undefined (the Docker of the environment, see {@link Docker})
     */
    @Configurable(DTO.String().optional())
    protected readonly socketPath?: string | undefined

    /**
     * The host name or IP address of the daemon, reached over TCP (`protocol` `'http'` or `'https'`) or SSH
     * (`'ssh'`).
     * @default undefined (the Docker of the environment, see {@link Docker})
     */
    @Configurable(DTO.String().optional())
    protected readonly host?: string | undefined

    /**
     * The port of the daemon on `host`: by convention 2375 over HTTP and 2376 over HTTPS; the SSH port for `'ssh'`.
     * @default undefined (80 over HTTP, 443 over HTTPS, 22 over SSH)
     */
    @Configurable(DTO.Alternatives(
        DTO.Number().port(),
        DTO.String()
    ).optional())
    protected readonly port?: number | string | undefined

    /**
     * The user of the SSH connections. There is no password: the SSH connection authenticates through the SSH agent
     * (see `sshAuthAgent`).
     * @default undefined
     */
    @Configurable(DTO.String().optional())
    protected readonly username?: string | undefined

    /**
     * The HTTP headers added to every request sent to the daemon (a proxy's credentials…), the Docker of the
     * environment's included.
     * @default undefined
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    protected readonly headers?: { [name: string]: string }

    /**
     * The certificates of the authorities trusted for the daemon's HTTPS certificate: their PEM contents, not their file
     * paths.
     * @default undefined (the authorities of Node.js)
     */
    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary())
    ).optional())
    protected readonly ca?: string | string[] | Buffer | Buffer[] | undefined

    /**
     * The client certificate of the HTTPS connections (its PEM contents), for a daemon verifying its clients
     * (`--tlsverify`).
     * @default undefined
     */
    @Configurable(DTO.Alternatives(
        DTO.String(),
        DTO.Array(DTO.String()),
        DTO.Binary(),
        DTO.Array(DTO.Binary())
    ).optional())
    protected readonly cert?: string | string[] | Buffer | Buffer[] | undefined

    /**
     * The private key of `cert` (its PEM contents), or keys with their passphrases ({@link IDockerKeyObject}).
     * @default undefined
     */
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

    /**
     * How `host` is reached: `'http'`, `'https'` (with `ca`, `cert` and `key`), or `'ssh'`. Over SSH, the requests
     * go through `docker system dial-stdio` run on the remote host (which needs the Docker CLI), and the optional package
     * `ssh2` must be installed, otherwise the component's creation fails with {@link DockerConnectionException}.
     * Ignored with `socketPath`.
     * @default 'https' when `ca`, `cert` and `key` are all given, 'http' otherwise
     */
    @Configurable(DTO.String().valid('https', 'http', 'ssh').optional())
    protected readonly protocol?: 'https' | 'http' | 'ssh' | undefined

    /**
     * How long a request may stay idle (no data received), in milliseconds; the request then fails with the error
     * "Timeout of … ms exceeded". It also applies to the streams (a followed log with no output for that long fails),
     * and to the Docker of the environment (over its `DOCKER_CLIENT_TIMEOUT`).
     * @default undefined (no timeout, or the environment's `DOCKER_CLIENT_TIMEOUT`)
     */
    @Configurable(DTO.Number().optional())
    protected readonly timeout?: number | undefined

    /**
     * The version of the Docker Engine API used by the requests (`'1.47'` or `'v1.47'`).
     * @default undefined (negotiated with the daemon: the newest version both support)
     */
    @Configurable(DTO.String().optional())
    protected readonly version?: string | undefined

    /**
     * The path of the SSH agent's socket, which authenticates the SSH connections.
     * @default undefined (the `SSH_AUTH_SOCK` environment variable)
     */
    @Configurable(DTO.String().optional())
    protected readonly sshAuthAgent?: string | undefined

    #client: DockerClient

    #abortController: AbortController = new AbortController()

    readonly #internalNetworkNames: string[] = ['bridge', 'host', 'none']

    /**
     * Connect to the daemon: ping it, then negotiate the API version.
     * @throws {DockerConnectionException} When the daemon cannot be reached or does not answer, or when an SSH
     * connection is configured without the package `ssh2`.
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            this.container.register(DockerImage),
            this.container.register(DockerContainer),
            this.container.register(DockerContainerTTY)
        ])
        //Without a socket nor a host, the Docker of the environment (DOCKER_HOST, the socket of Docker Desktop or of the
        //system, the named pipe of Windows), with the options given applied over it
        this.#client = new DockerClient({
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
        })
        try {
            await this.#client.ping()
            //The API version of the requests: the newest one supported by the daemon and this client
            await this.#client.connection.negotiate()
        } catch (e: any) {
            throw new DockerConnectionException(e.message ? e.message : 'Cannot connect to docker')
        }
    }

    /**
     * Abort the pulls, builds and listings in progress (the pulls and builds then reject), then close the connections
     * to the daemon.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
        this.#client?.close()
    }

    /** Docker Common Operations **/

    /**
     * Remove the daemon's unused resources, as `docker <kind> prune` does without options: the stopped containers, then
     * the dangling images (untagged and unused), the unused networks and the unused anonymous volumes. Without
     * options, the containers and the images are pruned; the networks and the volumes only when asked.
     * @param options The kinds of resources pruned: `containers` and `images` default to `true`, `networks` and
     * `volumes` to `false`.
     * @throws {InvalidMethodAcceptException} When the options are invalid.
     * @throws {DockerRequestException} When the daemon refuses a prune (one already running: HTTP 409).
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
     * Check credentials against a registry, as `docker login` does. The credentials are not kept: each pull, build or
     * push which needs them is given its own `auth`.
     * @param options The registry (`serverAddress`, a host name without protocol: `registry.example.com:5000`) and its
     * credentials (a password, or a token).
     * @throws {DockerRequestException} When the registry refuses the credentials or cannot be reached (the daemon's
     * status: HTTP 401, 500).
     */
    @Accept(DockerAuthOptions.required())
    public async loginRepository(options: DockerAuthOptions): Promise<void> {
        await this.#client.checkAuth(registryAuth(options))
    }

    /**
     * Whether a registry accepts credentials ({@link Docker.loginRepository} without its error).
     * @param options The registry (`serverAddress`, a host name without protocol) and its credentials.
     * @returns `true` when they are accepted; `false` on any failure, the daemon unreachable included.
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
     * List the daemon's images (as `docker images`, without the intermediate ones). Each image is inspected with a request
     * of its own, so the call costs one request per image; an image removed during the listing is not listed.
     * @returns The images, in the daemon's order.
     */
    public async listImages(): Promise<DockerImage[]> {
        const rawImages: Record<string, any>[] = await this.#client.listImages()
        const images: (DockerImage | undefined)[] = await Promise.all(rawImages.map(async (rawImage: Record<string, any>): Promise<DockerImage | undefined> => {
            try {
                return await this.#image(rawImage.Id)
            } catch (e) {
                //Removed since it was listed
                if (e instanceof DockerImageNotFoundException) return undefined
                throw e
            }
        }))
        return images.filter((image: DockerImage | undefined): image is DockerImage => !!image)
    }

    /**
     * The object of an image, inspected
     * @param id
     */
    async #image(id: string): Promise<DockerImage> {
        return await this.container.get(DockerImage, {
            id: id,
            getClient: () => this.#client,
            getDocker: () => this
        })
    }

    /**
     * Pull an image from its registry, as `docker pull`, and wait for its end.
     * @param options The repository (`alpine`, `registry.example.com:5000/team/app`), the tag (`'latest'` by default),
     * the platform (`linux/arm64`, the daemon's by default), the registry credentials, and a callback receiving each
     * progress message.
     * @returns The image pulled, found as `repo:tag` the way the daemon names it (`docker.io/library/alpine` is
     * `alpine`).
     * @throws {DockerImagePullException} When the pull fails: the image or the registry not found, refused credentials,
     * the daemon unreachable, or the component destroyed during the pull (its message then says it was aborted).
     */
    @Accept(ImagePullOptions.required())
    public async pullImage(options: ImagePullOptions): Promise<DockerImage> {
        const auth: DockerRegistryAuth | undefined = registryAuth(options.auth)
        const tag: string = options.tag ? options.tag : 'latest'
        try {
            const readableStream: NodeJS.ReadableStream = await this.#client.pullImage({fromImage: options.repo, tag: tag, platform: options.platform}, auth, this.#abortController.signal)
            let pullError: string | undefined
            await followProgress(readableStream, (outputObject: Record<string, any>): void => {
                if (options.outputCallback) options.outputCallback(outputObject)
                if (outputObject.error && !pullError) pullError = outputObject.error
            })
            if (pullError) throw new Error(pullError)
            //A tag or a digest
            return await this.getImage(tag.includes(':') ? `${options.repo}@${tag}` : `${options.repo}:${tag}`)
        } catch (e: any) {
            if (isAbortError(e)) throw new DockerImagePullException('The pull of {0} was aborted: the Docker component was destroyed', [options.repo])
            throw new DockerImagePullException(e.message)
        }
    }

    /**
     * Build an image with BuildKit, as `docker build`, and wait for its end. The build context is made of the `files`
     * of the `workdir` (relative paths; a directory with its content), without the ones its `.dockerignore` excludes,
     * and always with the Dockerfile. The progress is given to the output callback as the lines of
     * `docker build --progress=plain` (`{id: 'moby.buildkit.trace', stream: '#2 [1/2] FROM alpine'}`).
     *
     * With `auth`, the base images of the Dockerfile (its `FROM` lines) are pulled first with these credentials, as
     * BuildKit is not given them.
     * @param options The context (`workdir`, `files`), the Dockerfile, the name of the image (`repoTag`; a generated
     * `unnamed_img_…` name by default), the platform, the target stage, the build arguments, the registry credentials
     * and the output callback.
     * @returns The image built.
     * @throws {DockerImageBuildException} When the build fails: a step failing, the Dockerfile or a file of the context
     * missing, a base image which cannot be pulled, the daemon unreachable, or the component destroyed during the build
     * (its message then says it was aborted).
     */
    @Accept(ImageBuildOptions.required())
    public async buildImage(options: ImageBuildOptions): Promise<DockerImage> {
        const dockerfile: string = options.dockerfile ? options.dockerfile : 'Dockerfile'
        const auth: DockerRegistryAuth | undefined = registryAuth(options.auth)
        try {
            //The base images of a private registry are pulled with the credentials (BuildKit is not given them)
            if (auth) {
                const content: string = await readFile(path.resolve(options.workdir, dockerfile), {encoding: 'utf-8'})
                for (const baseImage of parseBaseImages(content, options.buildargs)) {
                    const [repo, tag] = [baseImage.replace(/:([^:/@]+)$/, ''), /:([^:/@]+)$/.exec(baseImage)?.[1]]
                    await this.pullImage({repo: repo, tag: tag, platform: options.platform, auth: options.auth, outputCallback: options.outputCallback})
                }
            }
            const context: NodeJS.ReadableStream = packBuildContext({directory: options.workdir, entries: options.files, always: [dockerfile]})
            const registryConfig: Record<string, DockerRegistryAuth> | undefined = auth ? {[auth.serveraddress ?? 'https://index.docker.io/v1/']: auth} : undefined
            const readableStream: NodeJS.ReadableStream = await this.#client.buildImage(context, {
                dockerfile: dockerfile,
                t: options.repoTag ? options.repoTag : `unnamed_img_${Date.now().toString(16)}${Math.floor(Math.random() * 255).toString(16).padStart(2, '0')}`,
                remote: options.remote,
                q: options.quiet || options.quite,
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
            await followProgress(readableStream, (outputObject: Record<string, any>): void => {
                if (outputObject.error && !buildError) buildError = outputObject.error
                if (outputObject.id === 'moby.buildkit.trace' && typeof outputObject.aux === 'string') {
                    for (const line of progress.lines(decodeBuildKitStatus(outputObject.aux))) options.outputCallback?.({id: outputObject.id, stream: line})
                    return
                }
                if (outputObject.aux && typeof outputObject.aux === 'object' && outputObject.aux.ID) imageId = outputObject.aux.ID
                options.outputCallback?.(outputObject)
            })
            if (buildError) throw new DockerImageBuildException(buildError)
            if (!imageId) throw new DockerImageBuildException('Build image failed')
            return await this.getImage(imageId)
        } catch (e: any) {
            if (isAbortError(e)) throw new DockerImageBuildException('The build was aborted: the Docker component was destroyed')
            if (e instanceof DockerImageBuildException) throw e
            throw new DockerImageBuildException(e.message)
        }
    }

    /**
     * Load an image from a tar archive written by `docker save` (or {@link DockerImage.export}), as `docker load`. The
     * tags saved in the archive are restored.
     * @param options The archive (`source`, a file path or a readable stream) and `quiet` (`false` by default).
     * @returns The image loaded.
     * @throws {DockerImageImportException} When the daemon rejects the archive, or when the loaded image is unknown.
     * @throws {Error} The error of the source when it cannot be read (`ENOENT` for a missing file), or the network
     * error when the archive cannot be sent.
     * @throws {DockerRequestException} When the daemon refuses the request.
     */
    @Accept(ImageImportOptions.required())
    public async importImage(options: ImageImportOptions): Promise<DockerImage> {
        const imageSourceReadableStream: NodeJS.ReadableStream = typeof options.source === 'string' ? createReadStream(options.source) : options.source
        const tarExtractPassThrough: PassThrough = new PassThrough()
        const loadImagePassThrough: PassThrough = new PassThrough()
        //An error of the source (a file which cannot be opened) fails the request sending it, then the call
        let sourceError: Error | undefined
        loadImagePassThrough.on('error', (): void => undefined)
        imageSourceReadableStream.once('error', (error: Error): void => {
            sourceError = error
            tarExtractPassThrough.destroy()
            loadImagePassThrough.destroy(error)
        })
        imageSourceReadableStream.pipe(tarExtractPassThrough)
        imageSourceReadableStream.pipe(loadImagePassThrough)
        const tarExtractor: Extract = tarExtract()
        //The manifest only completes the daemon's answer: an archive it cannot read is reported by the daemon
        tarExtractor.on('error', (): void => undefined)
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
        let importError: string | undefined
        let loadedImage: string | undefined
        try {
            const readableStream: NodeJS.ReadableStream = await this.#client.loadImage(loadImagePassThrough, {quiet: options.quiet})
            await followProgress(readableStream, (outputObject: Record<string, any>): void => {
                if (outputObject.error && !importError) importError = outputObject.error
                //"Loaded image ID: sha256:…" or "Loaded image: repo:tag"
                const loaded: RegExpExecArray | null = /Loaded image(?: ID)?: (\S+)/.exec(outputObject.stream ?? '')
                if (loaded && !loadedImage) loadedImage = loaded[1]
            })
        } catch (e) {
            throw sourceError ?? e
        }
        if (sourceError) throw sourceError
        if (importError) throw new DockerImageImportException(importError)
        const image: string | undefined = loadedImage ?? manifestImageId
        if (!image) throw new DockerImageImportException('The imported image is unknown')
        return await this.getImage(image)
    }

    /**
     * Get an image by its ID or its name, resolved by the daemon as `docker image inspect` does: the full ID
     * (`sha256:…`), a unique prefix of it (`d9e853e8`), a tag (`alpine:3.20`), a name without its tag for `:latest`
     * (`alpine`), a name with its registry (`docker.io/library/alpine:3.20`) or a digest (`alpine@sha256:…`).
     * @param repoTagOrId The ID, the short ID, the name or the digest of the image.
     * @returns The image.
     * @throws {DockerImageNotFoundException} When the daemon finds no image with this ID or name.
     */
    @Accept(DTO.String().required())
    public async getImage(repoTagOrId: string): Promise<DockerImage> {
        const inspectInfo: Record<string, any> = await this.#client.inspectImage(repoTagOrId)
        return await this.#image(inspectInfo.Id)
    }

    /** Docker Container Operations **/

    /**
     * List the daemon's containers, the stopped ones included (as `docker ps -a`). Each container is inspected, with its
     * image (see {@link Docker.getContainer}); a container removed during the listing is not listed.
     * @returns The containers; an empty list when the component is destroyed during the call.
     */
    public async listContainers(): Promise<DockerContainer[]> {
        try {
            const rawContainers: Record<string, any>[] = await this.#client.listContainers({all: true}, this.#abortController.signal)
            const containers: (DockerContainer | undefined)[] = await Promise.all(rawContainers.map(async (containerInfo: Record<string, any>): Promise<DockerContainer | undefined> => {
                try {
                    return await this.getContainer(containerInfo.Id)
                } catch (e) {
                    //Removed since it was listed
                    if (e instanceof DockerContainerNotFoundException) return undefined
                    throw e
                }
            }))
            return containers.filter((container: DockerContainer | undefined): container is DockerContainer => !!container)
        } catch (e) {
            if (!isAbortError(e)) throw e
            return []
        }
    }

    /**
     * Get a container by its ID, short ID or name, inspected with its image (`image` is `undefined` when its image no
     * longer exists, removed with force). The object is a snapshot: its properties are refreshed by its own operations
     * (`start()`, `stop()`…), not by the changes made by others.
     * @param id The ID, a unique prefix of it, or the name of the container.
     * @returns The container.
     * @throws {DockerContainerNotFoundException} When the daemon has no such container.
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
     * Create a container from an image, as `docker create`: it is not started (see {@link DockerContainer.start}, or
     * {@link DockerImage.run} to create and start it).
     * @param imageId The ID or the name (`alpine:3.20`) of a local image: it is not pulled.
     * @param options The container's settings: name, command, environment, ports, binds, devices, networks, limits…
     * @returns The container created.
     * @throws {DockerImageNotFoundException} When the image is not found.
     * @throws {DockerNetworkNotFoundException} When a network of the settings is not found.
     * @throws {DockerRequestException} When the daemon refuses the settings: the name already used (HTTP 409), an
     * invalid setting (HTTP 400).
     * @throws {InvalidMethodAcceptException} When the settings are invalid.
     */
    public async createContainer(imageId: string, options: ContainerSettingOptions): Promise<DockerContainer>
    /**
     * Create a container from an image for a platform, as `docker create --platform`: it is not started.
     * @param imageId The ID or the name (`alpine:3.20`) of a local image: it is not pulled.
     * @param platform The platform of the image used (`linux/arm64`), for an image having several.
     * @param options The container's settings: name, command, environment, ports, binds, devices, networks, limits…
     * @returns The container created.
     * @throws {DockerImageNotFoundException} When the image is not found for the platform.
     * @throws {DockerNetworkNotFoundException} When a network of the settings is not found.
     * @throws {DockerRequestException} When the daemon refuses the settings: the name already used (HTTP 409), an
     * invalid setting (HTTP 400).
     * @throws {InvalidMethodAcceptException} When the settings are invalid.
     */
    public async createContainer(imageId: string, platform: string, options: ContainerSettingOptions): Promise<DockerContainer>
    @Accept(DTO.String().required(), DTO.Alternatives(DTO.String(), ContainerSettingOptions.required()).required(), ContainerSettingOptions.optional())
    public async createContainer(imageId: string, platformOrOptions: string | ContainerSettingOptions, settingOptions?: ContainerSettingOptions): Promise<DockerContainer> {
        //The platform is optional: the one of the image by default
        const platform: string | undefined = typeof platformOrOptions === 'string' ? platformOrOptions : undefined
        const options: ContainerSettingOptions = typeof platformOrOptions === 'string' ? settingOptions ?? {} : platformOrOptions
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
                RestartPolicy: options.restartPolicy ? engineRestartPolicy(options.restartPolicy) : undefined,
                OomKillDisable: options.OOMKillDisable,
                PortBindings: enginePortBindings(options.ports ?? []),
                Binds: engineBinds(options.binds ?? []),
                Devices: engineDevices(options.devices ?? []),
                CapAdd: options.capabilities,
                Cgroup: options.cgroup,
                CgroupParent: options.cgroupParent,
                PidMode: options.pidMode
            },
            NetworkingConfig: {
                EndpointsConfig: engineEndpoints(options.networks ?? [])
            }
        }, {name: options.name, platform: platform})
        return await this.getContainer(rawContainer.Id)
    }

    /** Docker Network Operations **/

    /**
     * Create a network, as `docker network create`.
     * @param options The name, the driver (`'bridge'` by default, `'ipvlan'`, `'macvlan'`), its options, the subnets
     * (`NetworkIPAMConfigs`; chosen by the daemon when empty or absent), `internal` and `enableIPv6`.
     * @returns The network created.
     * @throws {DockerRequestException} When the daemon refuses the network: the name already used (HTTP 409), a subnet
     * overlapping another network's (HTTP 400).
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
                Config: (options.NetworkIPAMConfigs ?? []).map((config: NetworkIPAMConfig): Record<string, any> => ({
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
     * Remove a network, as `docker network rm`.
     * @param id The ID, a unique prefix of it, or the name of the network.
     * @throws {DockerNetworkNotFoundException} When the daemon has no such network.
     * @throws {DockerRequestException} When the network has containers connected (HTTP 409), or is reserved (`bridge`,
     * `host`, `none`: HTTP 403).
     */
    @Accept(DTO.String().required())
    public async removeNetwork(id: string): Promise<void> {
        const network: NetworkInfo = await this.getNetwork(id)
        await this.#client.removeNetwork(network.id)
    }

    /**
     * List the daemon's networks, the reserved ones (`bridge`, `host`, `none`) included.
     * @returns The networks; an empty list when the component is destroyed during the call.
     */
    public async listNetworks(): Promise<NetworkInfo[]> {
        try {
            const rawNetworks: Record<string, any>[] = await this.#client.listNetworks(undefined, this.#abortController.signal)
            return rawNetworks.map((rawNetwork: Record<string, any>): NetworkInfo => this.#networkInfo(rawNetwork))
        } catch (e) {
            if (!isAbortError(e)) throw e
            return []
        }
    }

    /**
     * Get a network by its ID, a unique prefix of it, or its name, as `docker network inspect`.
     * @param id The ID, a unique prefix of it, or the name of the network.
     * @returns The network.
     * @throws {DockerNetworkNotFoundException} When the daemon has no such network.
     */
    @Accept(DTO.String().required())
    public async getNetwork(id: string): Promise<NetworkInfo> {
        return this.#networkInfo(await this.#client.inspectNetwork(id))
    }

    /**
     * The information of a network, from the daemon's
     * @param rawNetwork
     */
    #networkInfo(rawNetwork: Record<string, any>): NetworkInfo {
        return {
            id: rawNetwork.Id,
            name: rawNetwork.Name,
            driver: rawNetwork.Driver,
            reserved: this.#internalNetworkNames.includes(rawNetwork.Name),
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
        }
    }
}
