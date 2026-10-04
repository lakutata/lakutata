import {Component, DTO} from '@lakutata/core'
import {Singleton, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {ContainerdClient, type ContainerdEvent} from '../client/ContainerdClient.js'
import {ImageStore} from '../client/ImageStore.js'
import {ContainerStore, type ContainerMount} from '../client/ContainerStore.js'
import {FormatPlatform, HostPlatform, ParsePlatform, SupportedPlatforms, type Platform} from '../client/Platforms.js'
import {ParseReference} from '../client/Reference.js'
import {DEFAULT_NETWORK, NetworkStore, type CNINetwork, type PortMapping} from '../client/Networks.js'
import {GRPCConnection, type Message} from '@lakutata/grpc'
import {BuildKitBuild, BuildKitPlatforms, BuildKitVersion} from '../client/BuildKit.js'
import {mkdir, rm} from 'node:fs/promises'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import type {RegistryCredentials, RegistryOptions} from '../client/Registry.js'
import {ContainerdImage} from './lib/ContainerdImage.js'
import {ContainerdContainer} from './lib/ContainerdContainer.js'
import {ContainerdContainerTTY} from './lib/ContainerdContainerTTY.js'
import {ContainerdPruneOptions} from './options/ContainerdPruneOptions.js'
import {VolumeCreateOptions} from './options/volume/VolumeCreateOptions.js'
import type {ContainerdVolumeInfo} from './types/ContainerdVolumeInfo.js'
import type {ContainerdPruneResult} from './types/ContainerdPruneResult.js'
import {ContainerdVolumeNotFoundException} from './exceptions/ContainerdVolumeNotFoundException.js'
import {ContainerdVolumeInUseException} from './exceptions/ContainerdVolumeInUseException.js'
import {VolumeStore, type Volume} from '../client/Volumes.js'
import {Time} from '@lakutata/utils/Time'
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
 * The containerd component: manages the images, containers, CNI networks and volumes of one containerd namespace by
 * talking to containerd's gRPC socket directly, without a Docker daemon and without nerdctl. Use it on the Linux machines
 * running containerd alone (embedded devices, servers without Docker); the application needs access to the socket (root,
 * or a member of the group owning it). Register it in the `components` of an application (`{class: Containerd, ...}`)
 * and get it with `getObject()` or `@Inject`; it is a singleton.
 *
 * Its API follows the Docker component's (`pullImage`, `createContainer`, `container.exec()`…). The containers it creates
 * are nerdctl's: they carry nerdctl's labels (`nerdctl/name`…), so `nerdctl ps` lists them; containerd's shim writes
 * their output to a log file and containerd's restart monitor applies their restart policy, also while the application
 * is not running. The component pulls, pushes, imports and exports the images itself; it sends the builds to BuildKit
 * (a local or remote `buildkitd`).
 *
 * The component connects when it is created: it fails with {@link ContainerdConnectionException} when containerd does
 * not answer on `socketPath` (or `buildkitTLS` is given with a unix socket), and it creates its namespace when the
 * namespace does not exist. BuildKit is only reached by
 * the builds. When the component is destroyed, it ends its event streams, aborts its pulls, pushes and builds in
 * progress, and closes its connections.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Containerd, type ContainerdContainer, type ContainerdExecResult, type ContainerdImage} from 'lakutata/com/containerd'
 *
 * Application
 *     .run(() => ({
 *         id: 'device.app',
 *         name: 'Device',
 *         components: {
 *             containerd: {
 *                 class: Containerd,
 *                 socketPath: '/run/containerd/containerd.sock',
 *                 namespace: 'default',
 *                 registryAuths: {'registry.example.com': {username: 'deploy', password: 'secret'}}
 *             }
 *         },
 *         bootstrap: ['containerd']
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const containerd: Containerd = await app.getObject('containerd')
 *         //Pulled for the machine's platform, unpacked into the snapshotter
 *         const image: ContainerdImage = await containerd.pullImage({image: 'alpine:3.20'})
 *         const container: ContainerdContainer = await containerd.createContainer({
 *             image: image.name,
 *             name: 'worker',
 *             cmd: ['sleep', 'infinity'],
 *             //Restarted by containerd, even when the application is not running
 *             restartPolicy: 'always'
 *         })
 *         await container.start()
 *         const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release'})
 *         console.log(result.exitCode, result.stdout)
 *     })
 * ```
 */
@Singleton()
export class Containerd extends Component {

    /**
     * The path of containerd's gRPC socket.
     * @default '/run/containerd/containerd.sock'
     */
    @Configurable(DTO.String().optional().default('/run/containerd/containerd.sock'))
    protected readonly socketPath: string

    /**
     * The containerd namespace holding the component's images and containers: `default` is nerdctl's, `k8s.io` the one
     * of Kubernetes. Letters, digits, `_`, `.` and `-`, starting with a letter or a digit; created when the component
     * starts if it does not exist. The volumes are kept apart by namespace too.
     * @default 'default'
     */
    @Configurable(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).optional().default('default'))
    protected readonly namespace: string

    /**
     * The containerd snapshotter unpacking the images and holding the containers' root file systems: `overlayfs`, or
     * `native` where overlayfs is not available.
     * @default 'overlayfs'
     */
    @Configurable(DTO.String().optional().default('overlayfs'))
    protected readonly snapshotter: string

    /**
     * The containerd runtime running the containers.
     * @default 'io.containerd.runc.v2'
     */
    @Configurable(DTO.String().optional().default('io.containerd.runc.v2'))
    protected readonly runtime: string

    /**
     * How runc manages the containers' cgroups: `cgroupfs`, or `systemd` when containerd's configuration sets
     * `SystemdCgroup = true` for runc. It must match the machine's setup, or the containers fail to start.
     * @default 'cgroupfs'
     */
    @Configurable(DTO.String().valid('cgroupfs', 'systemd').optional().default('cgroupfs'))
    protected readonly cgroupManager: 'cgroupfs' | 'systemd'

    /**
     * The directory holding the component's files: each container's state (its log file, `hosts`, `resolv.conf`,
     * `hostname` and the settings it was created with) under `containers/<namespace>/<id>`, the named volumes under
     * `volumes/<namespace>`, and the temporary files of the builds and imports under `tmp`.
     * @default '/var/lib/lakutata/containerd'
     */
    @Configurable(DTO.String().optional().default('/var/lib/lakutata/containerd'))
    protected readonly dataRoot: string

    /**
     * The size, in bytes, beyond which a container's log file is rotated when the component starts the container: the
     * file is copied to `<log>.1` (replacing the previous copy) and emptied. Only checked at the starts made by the
     * component, not at the restarts made by containerd's restart monitor. `0` never rotates.
     * @default 0
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(0))
    protected readonly logMaxSize: number

    /**
     * The directory of the CNI network configurations (`nerdctl-<name>.conflist`), shared with nerdctl.
     * @default '/etc/cni/net.d'
     */
    @Configurable(DTO.String().optional().default('/etc/cni/net.d'))
    protected readonly cniConfigPath: string

    /**
     * The directories searched for the CNI plugins (`bridge`, `portmap`…); the ones that exist are used. A container
     * joining a CNI network fails to be created when none of them exists.
     * @default ['/opt/cni/bin', '/usr/lib/cni', '/usr/libexec/cni']
     */
    @Configurable(DTO.Array(DTO.String()).optional().default(['/opt/cni/bin', '/usr/lib/cni', '/usr/libexec/cni']))
    protected readonly cniPath: string[]

    /**
     * The address of the BuildKit daemon building the images: a unix socket (`unix:///run/buildkit/buildkitd.sock`, or
     * an absolute path) or a remote daemon (`tcp://host:1234`). It is only reached by {@link Containerd.buildImage},
     * {@link Containerd.buildkitVersion} and {@link Containerd.buildkitPlatforms}: the component starts without BuildKit.
     * @default 'unix:///run/buildkit/buildkitd.sock'
     */
    @Configurable(DTO.String().pattern(/^(\/|unix:\/\/\/|tcp:\/\/)/).optional().default('unix:///run/buildkit/buildkitd.sock'))
    protected readonly buildkitAddress: string

    /**
     * Turns TLS on for a remote BuildKit (`tcp://`): `ca` verifies the daemon's certificate, `cert` and `key` are the
     * client's certificate and key (PEM, as strings or buffers), `servername` is the name checked in the daemon's
     * certificate (the address's host by default). Given with a unix socket address, it makes the component fail when it
     * is created, with {@link ContainerdConnectionException}.
     * @default none (plain TCP)
     */
    @Configurable(DTO.Object({
        ca: DTO.Alternatives(DTO.String(), DTO.Binary()).optional(),
        cert: DTO.Alternatives(DTO.String(), DTO.Binary()).optional(),
        key: DTO.Alternatives(DTO.String(), DTO.Binary()).optional(),
        servername: DTO.String().optional()
    }).optional())
    protected readonly buildkitTLS?: { ca?: string | Buffer, cert?: string | Buffer, key?: string | Buffer, servername?: string }

    /**
     * The registry credentials, by registry host (`docker.io`, `registry.example.com:5000`): a `username` and a
     * `password`, or an `identityToken`. They are used by the pulls, the pushes and the base images of the builds; the
     * `auth` option of a call replaces the credentials of its image's registry.
     * @default none (anonymous access)
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Object({
        username: DTO.String().optional(),
        password: DTO.String().optional(),
        identityToken: DTO.String().optional()
    })).optional())
    protected readonly registryAuths?: Record<string, RegistryCredentials>

    /**
     * The registries reached over plain HTTP instead of HTTPS, by host (`localhost:5000`).
     * @default none
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
     * Connect to containerd and create the namespace when it does not exist.
     * @throws {ContainerdConnectionException} containerd does not answer on `socketPath` (not running, no access to the
     * socket), or `buildkitTLS` is given with a unix socket `buildkitAddress`.
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            this.container.register(ContainerdImage),
            this.container.register(ContainerdContainer),
            this.container.register(ContainerdContainerTTY)
        ])
        //Not connected until a build: its options checked
        try {
            this.#buildkit = new GRPCConnection(this.buildkitAddress, this.buildkitTLS)
        } catch (e: any) {
            throw new ContainerdConnectionException(`Cannot connect to BuildKit (${this.buildkitAddress}): ${e.message}`)
        }
        this.#client = new ContainerdClient(this.socketPath, this.namespace)
        try {
            await this.#client.version()
            await this.#client.ensureNamespace()
        } catch (e: any) {
            throw new ContainerdConnectionException(`Cannot connect to containerd (${this.socketPath}): ${e.message}`)
        }
        //The platforms of the machine unpacked by the pulls and the imports
        this.#images = new ImageStore(this.#client, this.snapshotter, path.join(this.dataRoot, 'tmp'), (): Platform[] => this.#platforms.map(ParsePlatform))
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
     * End the event streams, abort the pulls, pushes and builds in progress, and close the connections to containerd and
     * BuildKit. The containers keep running.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
        this.#client?.close()
        this.#buildkit?.close()
    }

    /**
     * Build the registry options of a pull, a push or a build: the configured credentials (`auth` replacing the ones of
     * the reference's registry), the insecure registries, and the component's abort signal.
     * @param reference The image reference whose registry gets `auth` (`registry.example.com/team/app:1.0`).
     * @param auth The credentials of the reference's registry; ignored without `reference`.
     * @returns The registry options.
     * @protected
     */
    protected registryOptions(reference?: string, auth?: RegistryCredentials): RegistryOptions {
        const credentials: Record<string, RegistryCredentials> = {...this.registryAuths ?? {}}
        if (reference && auth) credentials[ParseReference(reference).registry] = auth
        return {credentials: credentials, insecure: this.insecureRegistries ?? [], signal: this.#abortController.signal}
    }

    /** Containerd Common Operations **/

    /**
     * Get the version of containerd.
     * @returns Its version (`1.7.36`, `v2.4.1`) and its git revision.
     * @throws {GRPCError} containerd no longer answers (from `@lakutata/grpc`).
     */
    public async version(): Promise<{ version: string, revision: string }> {
        return await this.#client.version()
    }

    /**
     * List the platforms this machine runs containers of: its own, and the ones of the emulators registered in
     * `binfmt_misc` (QEMU, Rosetta), as detected when the component was created or by
     * {@link Containerd.detectPlatforms}. An image is described for the first of its platforms in this list.
     * @returns A copy of the list, formatted `os/architecture[/variant]` (`linux/arm64/v8`, `linux/amd64`).
     */
    public supportedPlatforms(): string[] {
        return [...this.#platforms]
    }

    /**
     * Detect again the platforms this machine runs, after emulators were registered or removed in `binfmt_misc`.
     * @returns The platforms detected, as {@link Containerd.supportedPlatforms} returns them from now on.
     */
    public detectPlatforms(): string[] {
        this.#platforms = SupportedPlatforms().map(FormatPlatform)
        return this.supportedPlatforms()
    }

    /**
     * Stream containerd's events in the component's namespace (`/tasks/exit`, `/containers/create`, `/images/delete`…)
     * as they happen. The stream ends without an error when `signal` aborts or when the component is destroyed. The
     * fields of the task, container, image and snapshot events are decoded; the other events have an empty `event`.
     * @param signal Ends the stream when aborted; without it, the stream lasts as long as the component.
     * @returns The events, in their order.
     * @throws {GRPCError} The connection to containerd fails or is lost (from `@lakutata/grpc`).
     */
    public async* events(signal?: AbortSignal): AsyncGenerator<ContainerdEvent> {
        const abort: AbortSignal = signal ? AbortSignal.any([signal, this.#abortController.signal]) : this.#abortController.signal
        yield* this.#client.subscribe([`namespace==${this.namespace}`], abort)
    }

    /** Containerd Image Operations **/

    /**
     * List the images of the namespace, each one described as {@link Containerd.getImage} does. The images whose content
     * is not complete (a pull in progress, content collected) or that have none of their platforms' content are left
     * out.
     * @returns The images.
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
     * Get an image present in containerd; it is not pulled. The image is described for the first platform it has among
     * {@link Containerd.supportedPlatforms}, or for the first platform it has.
     * @param name Its name or a reference, normalized as Docker does (`alpine` is `docker.io/library/alpine:latest`).
     * @returns The image.
     * @throws {ContainerdImageNotFoundException} No image has this name.
     * @throws {ContainerdPlatformException} The content of none of its platforms is present.
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
     * Pull an image from its registry: the manifests of the platforms asked, their configurations and layers, then
     * unpack the ones the machine runs ({@link Containerd.supportedPlatforms}) into the snapshotter so that containers
     * can run them; the other platforms are only stored. The image is named by its normalized reference
     * (`docker.io/library/alpine:3.20`); an image of the same name is replaced. The pull is aborted when the component
     * is destroyed.
     * @param options The reference, the platforms (the machine's by default, `'all'` for every one), the registry
     * credentials (`auth`, else the `registryAuths` of its registry), `unpack` and the progress callback.
     * @returns The image pulled.
     * @throws {ContainerdPlatformException} The image has no manifest for one of the platforms asked.
     * @throws {ContainerdImagePullException} The registry cannot be reached, refuses the credentials, or does not have
     * the reference; the transfer fails or is aborted; the unpacking fails (the image is stored).
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
     * Get the version of the BuildKit daemon at `buildkitAddress`.
     * @returns Its package (`github.com/moby/buildkit`), version and revision.
     * @throws {ContainerdImageBuildException} BuildKit cannot be reached.
     */
    public async buildkitVersion(): Promise<{ package: string, version: string, revision: string }> {
        try {
            return await BuildKitVersion(this.#buildkit)
        } catch (error: unknown) {
            throw new ContainerdImageBuildException(`Cannot connect to BuildKit (${this.buildkitAddress}): ${(error as Error).message}`)
        }
    }

    /**
     * List the platforms the BuildKit daemon builds for: the ones of its workers, including the emulators of its own
     * machine.
     * @returns The platforms, formatted `os/architecture[/variant]`.
     * @throws {ContainerdImageBuildException} BuildKit cannot be reached.
     */
    public async buildkitPlatforms(): Promise<string[]> {
        try {
            return (await BuildKitPlatforms(this.#buildkit)).map(FormatPlatform)
        } catch (error: unknown) {
            throw new ContainerdImageBuildException(`Cannot connect to BuildKit (${this.buildkitAddress}): ${(error as Error).message}`)
        }
    }

    /**
     * Build an image with BuildKit (the local or remote daemon at `buildkitAddress`), as `docker buildx build` does: the
     * build context (without the files its `.dockerignore` excludes) and the Dockerfile are sent over a BuildKit session,
     * then the image built is imported into containerd, named by `repoTag`, and pushed when `push` is set. The base
     * images are pulled by BuildKit with the component's registry credentials (or `auth`). The build is aborted when the
     * component is destroyed.
     * @param options The context directory, the Dockerfile, the name, the platforms (the machine's by default), the build
     * arguments, labels and target, `nocache`, `pull`, `push`, the credentials and the output callback.
     * @returns The image built.
     * @throws {ContainerdImageBuildException} BuildKit cannot be reached, the build fails, or its import fails.
     * @throws {ContainerdImagePushException} With `push`, the push fails; the image is built and imported.
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
     * Import the images of an archive: an OCI image layout (`nerdctl save`, `docker save` of Docker 25+, the archives of
     * {@link Containerd.exportImages}) or an older `docker save` archive. The images are named as the archive names
     * them (or by `name`, for an archive of one image), replace the images of the same names, and the platforms the
     * machine runs ({@link Containerd.supportedPlatforms}) are unpacked unless `unpack: false`. The images of an OCI
     * layout without a name annotation are not imported unless `name` is given.
     * @param options The archive (a file path or a readable stream), the name to give, and `unpack`.
     * @returns The images imported.
     * @throws {ContainerdImageImportException} The archive cannot be read or is not an image archive; `name` is given
     * with an archive of several images (nothing is imported); the unpacking fails (the images are stored and named).
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
     * Export images into one archive: an OCI image layout with the `manifest.json` of `docker load`, loaded by
     * `docker load`, `nerdctl load` and {@link Containerd.importImage}. The archive has the platforms each image has in
     * containerd.
     * @param names The names or references of the images (one at least).
     * @param options The destination: a file path (created or replaced) or a writable stream.
     * @throws {ContainerdImageNotFoundException} One of the images does not exist.
     * @throws {ContainerdImageExportException} The archive cannot be written.
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
     * Describe a CNI network.
     * @param network The network, as read from its configuration file.
     * @returns Its information.
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
            enableIPv6: network.subnets.some((subnet: string): boolean => subnet.includes(':')),
            subnets: network.subnets,
            gateways: network.gateways,
            labels: network.labels,
            file: network.file
        }
    }

    /**
     * List the networks: `host` and `none`, then the CNI networks of `cniConfigPath`, among them nerdctl's default
     * `bridge` once it exists (it is created when a container or {@link Containerd.getNetwork} first asks for it).
     * @returns The networks.
     */
    public async listNetworks(): Promise<ContainerdNetworkInfo[]> {
        const system: ContainerdNetworkInfo[] = ['host', 'none'].map((name: string): ContainerdNetworkInfo => ({id: name, name: name, driver: name, reserved: true, internal: name === 'none', enableIPv6: false, subnets: [], gateways: [], labels: {}}))
        return [...system, ...(await this.#networks.list()).map((network: CNINetwork): ContainerdNetworkInfo => this.networkInfo(network))]
    }

    /**
     * Get a network. Asking for `bridge` creates nerdctl's default network when it does not exist.
     * @param nameOrId Its name, its identifier, or a prefix of its identifier (3 characters at least).
     * @returns The network.
     * @throws {ContainerdNetworkNotFoundException} No network matches.
     */
    @Accept(DTO.String().required())
    public async getNetwork(nameOrId: string): Promise<ContainerdNetworkInfo> {
        if (nameOrId === 'host' || nameOrId === 'none') return (await this.listNetworks()).find((network: ContainerdNetworkInfo): boolean => network.name === nameOrId)!
        const network: CNINetwork | undefined = await this.#networks.get(nameOrId)
        if (!network) throw new ContainerdNetworkNotFoundException(`The network ${nameOrId} does not exist`)
        return this.networkInfo(network)
    }

    /**
     * Create a CNI network as `nerdctl network create` does: its configuration `nerdctl-<name>.conflist` written in
     * `cniConfigPath`, so nerdctl sees it. Its bridge and firewall rules are set up when the first container joins it.
     * @param options Its name, driver (`bridge`, `macvlan`, `ipvlan`), IPv4 subnet (a free one of `10.4.0.0/16` by
     * default), gateway and range, IPv6 subnet, parent interface, `internal`, MTU and labels.
     * @returns The network created.
     * @throws {ContainerdNetworkConflictException} The name is taken (`host`, `none` and `bridge` included), or the subnet
     * overlaps another network's.
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
     * Remove a CNI network created by nerdctl or by the component, as `nerdctl network rm` does: its configuration, its
     * bridge and the leases of its addresses.
     * @param nameOrId Its name, its identifier, or a prefix of its identifier.
     * @throws {ContainerdNetworkNotFoundException} No network matches (`host` and `none` included).
     * @throws {ContainerdNetworkConflictException} A container of the namespace uses it, it is the default `bridge`, or
     * it was not created by nerdctl (its configuration is left to remove by hand).
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
     * List the containers of the namespace, running or not, the ones created by nerdctl included.
     * @param labels Only the containers having all these labels with these values (`{app: 'web'}`); all of them by
     * default.
     * @returns The containers.
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
     * Get a container.
     * @param idOrName Its identifier, its name, or a prefix of its identifier (3 hexadecimal characters at least).
     * @returns The container, its information read from containerd.
     * @throws {ContainerdContainerNotFoundException} No container matches.
     * @throws {Error} The prefix matches several containers.
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
     * Create a container of an image present in containerd (it is not pulled): its snapshot, its OCI specification and
     * its state directory (log file, `hosts`, `resolv.conf`, `hostname`). The container is not started. It runs on the
     * host's network by default; `ports` need CNI `networks` (`[{networkName: 'bridge'}]`) and are published on the first
     * one. Its system calls are filtered by containerd's default seccomp profile, unless it is privileged or
     * `seccompProfile` says otherwise. The settings are kept so that {@link ContainerdContainer.update} can create it
     * again.
     * @param options The image and the container's settings (name, command, environment, user, mounts, devices,
     * networks, ports, resources, restart policy…).
     * @returns The container created.
     * @throws {ContainerdImageNotFoundException} The image does not exist.
     * @throws {ContainerdPlatformException} The image has no manifest for the platform asked (the machine's by default).
     * @throws {ContainerdContainerNameConflictException} Another container has the name.
     * @throws {ContainerdNetworkNotFoundException} One of the CNI networks does not exist.
     * @throws {Error} The settings cannot be applied: ports without a CNI network, no command, no CNI plugin installed, a
     * device or a seccomp profile file that cannot be read.
     */
    @Accept(ContainerCreateOptions.required())
    public async createContainer(options: ContainerCreateOptions): Promise<ContainerdContainer> {
        const mounts: ContainerMount[] = [
            ...(options.binds ?? []).map((bind): ContainerMount => ({type: 'bind', source: bind.hostPath, target: bind.containerPath, readonly: bind.rw === false, options: bind.propagation ? [bind.propagation] : undefined})),
            ...(options.tmpfs ?? []).map((tmpfs): ContainerMount => ({type: 'tmpfs', target: tmpfs.containerPath, options: [...tmpfs.size ? [`size=${tmpfs.size}`] : [], ...tmpfs.mode ? [`mode=${tmpfs.mode}`] : []]})),
            ...(options.volumes ?? []).map((volume): ContainerMount => ({type: 'volume', source: volume.volumeName, target: volume.containerPath, readonly: volume.readonly}))
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
                seccompProfile: options.seccompProfile,
                mounts: mounts,
                devices: (options.devices ?? []).map(device => ({hostPath: device.hostPath, containerPath: device.containerPath, permissions: device.cgroupPermissions})),
                deviceCgroupRules: options.deviceCgroupRules,
                network: options.networks?.length ? options.networks.map((network): { name: string, ip?: string, ipv6?: string } => ({name: network.networkName, ip: network.ip || undefined, ipv6: network.ipv6 || undefined})) : options.network,
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
        //Its settings: the ones it is created again with by its update
        await this.#containers.writeSettings(record.id, Object.fromEntries(Object.entries(options).filter(([, value]): boolean => value !== undefined && typeof value !== 'function')))
        return await this.getContainer(record.id)
    }

    /**
     * Replace a container by a new one created with other settings, as {@link ContainerdContainer.update} does: the old
     * container is renamed, the new one created with `options`, then the old one removed by force, and the new one
     * started when the old one was running or paused. When the creation fails, the old container gets its name back
     * and keeps running.
     * @param record The containerd record of the container to replace.
     * @param options The complete settings of the new container.
     * @returns The new container.
     * @throws {ContainerdContainerNotFoundException} The container no longer exists.
     * @throws {ContainerdImageNotFoundException} From the creation, as {@link Containerd.createContainer} throws.
     */
    public async recreateContainer(record: Message, options: ContainerCreateOptions): Promise<ContainerdContainer> {
        const old: ContainerdContainer = await this.getContainer(record.id)
        const running: boolean = old.state.running || old.state.paused
        const name: string = old.name
        await this.#containers.rename(record, `${name}-replaced-${randomBytes(4).toString('hex')}`)
        let created: ContainerdContainer
        try {
            created = await this.createContainer(options)
        } catch (error: unknown) {
            await this.#containers.rename((await this.#containers.find(record.id))!, name).catch((): undefined => undefined)
            throw error
        }
        await old.remove({force: true})
        if (running) await created.start()
        return created
    }

    /** Containerd Volume Operations **/

    /**
     * Describe a named volume.
     * @param volume The volume, as read from its directory.
     * @returns Its information.
     * @protected
     */
    protected volumeInfo(volume: Volume): ContainerdVolumeInfo {
        return {name: volume.name, mountpoint: volume.mountpoint, labels: volume.labels, createdAt: new Time(volume.createdAt)}
    }

    /**
     * The store of the namespace's named volumes, under `<dataRoot>/volumes/<namespace>`.
     * @protected
     */
    protected get volumes(): VolumeStore {
        return this.#containers.volumes
    }

    /**
     * List the containers mounting a volume, running or not.
     * @param name The volume's name.
     * @returns The names of the containers.
     * @protected
     */
    protected async volumeUsers(name: string): Promise<string[]> {
        return (await this.#containers.list())
            .filter((record: Message): boolean => ContainerStore.Volumes(record).includes(name))
            .map((record: Message): string => ContainerStore.Name(record))
    }

    /**
     * List the named volumes of the namespace, sorted by name.
     * @returns The volumes.
     */
    public async listVolumes(): Promise<ContainerdVolumeInfo[]> {
        return (await this.volumes.list()).map((volume: Volume): ContainerdVolumeInfo => this.volumeInfo(volume))
    }

    /**
     * Get a named volume.
     * @param name The volume's name.
     * @returns The volume: its host directory (`mountpoint`), labels and creation time.
     * @throws {ContainerdVolumeNotFoundException} The volume does not exist, or the name is not a valid one.
     */
    @Accept(DTO.String().required())
    public async getVolume(name: string): Promise<ContainerdVolumeInfo> {
        const volume: Volume | undefined = VolumeStore.ValidName(name) ? await this.volumes.get(name) : undefined
        if (!volume) throw new ContainerdVolumeNotFoundException(`The volume ${name} does not exist`)
        return this.volumeInfo(volume)
    }

    /**
     * Create a named volume: a directory under `dataRoot` that containers mount by name. As Docker does, a volume that
     * exists is returned unchanged (its labels are not updated). A container mounting a missing volume creates it too.
     * @param options The name (letters, digits, `_`, `.` and `-`) and the labels.
     * @returns The volume.
     */
    @Accept(VolumeCreateOptions.required())
    public async createVolume(options: VolumeCreateOptions): Promise<ContainerdVolumeInfo> {
        return this.volumeInfo(await this.volumes.create(options.name, options.labels ?? {}))
    }

    /**
     * Remove a named volume and its data.
     * @param name The volume's name.
     * @throws {ContainerdVolumeNotFoundException} The volume does not exist.
     * @throws {ContainerdVolumeInUseException} A container of the namespace mounts it, even a stopped one.
     */
    @Accept(DTO.String().required())
    public async removeVolume(name: string): Promise<void> {
        await this.getVolume(name)
        const users: string[] = await this.volumeUsers(name)
        if (users.length) throw new ContainerdVolumeInUseException(`The volume ${name} is used by the containers ${users.join(', ')}`)
        await this.volumes.remove(name)
    }

    /** Containerd Common Operations **/

    /**
     * Remove the unused resources of the namespace, in this order: the containers that are not running (created or
     * exited), the images no container uses (the dangling ones, without a tag, or all of them with `allImages`), the CNI
     * networks no container uses (except the default `bridge` and the ones nerdctl did not create), and the volumes no
     * container mounts. A container, image, network or volume that fails to be removed is skipped (left out of the
     * result).
     * @param options What to remove: `containers` and `images` by default, `allImages`, `networks` and `volumes` when
     * set.
     * @returns The names (identifiers of the containers) of what was removed.
     */
    @Accept(ContainerdPruneOptions.optional())
    public async prune(options?: ContainerdPruneOptions): Promise<ContainerdPruneResult> {
        if (!options) return await this.prune({})
        const result: ContainerdPruneResult = {containers: [], images: [], networks: [], volumes: []}
        if (options.containers) {
            for (const container of await this.listContainers()) {
                if (container.state.status !== 'exited' && container.state.status !== 'created') continue
                await container.remove({force: false}).then((): unknown => result.containers.push(container.id), (): undefined => undefined)
            }
        }
        const records: Message[] = await this.#containers.list()
        if (options.images || options.allImages) {
            const used: Set<string> = new Set(records.map((record: Message): string => record.image))
            for (const image of await this.#client.listImages()) {
                if (used.has(image.name)) continue
                const dangling: boolean = (() => {
                    try {
                        return !ParseReference(image.name).tag
                    } catch {
                        return true
                    }
                })()
                if (!options.allImages && !dangling) continue
                await this.#images.remove(image.name).then((): unknown => result.images.push(image.name), (): undefined => undefined)
            }
        }
        if (options.networks) {
            const usedNetworks: Set<string> = new Set(records.flatMap((record: Message): string[] => {
                try {
                    return JSON.parse(record.labels?.['nerdctl/networks'] ?? '[]') as string[]
                } catch {
                    return []
                }
            }))
            for (const network of await this.#networks.list()) {
                if (!network.managed || network.labels['nerdctl/default-network'] === 'true' || usedNetworks.has(network.name)) continue
                await this.#networks.remove(network).then((): unknown => result.networks.push(network.name), (): undefined => undefined)
            }
        }
        if (options.volumes) {
            const usedVolumes: Set<string> = new Set(records.flatMap((record: Message): string[] => ContainerStore.Volumes(record)))
            for (const volume of await this.volumes.list()) {
                if (usedVolumes.has(volume.name)) continue
                await this.volumes.remove(volume.name).then((): unknown => result.volumes.push(volume.name), (): undefined => undefined)
            }
        }
        return result
    }
}
