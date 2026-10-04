import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {Time} from '@lakutata/utils/Time'
import type {Readable} from 'node:stream'
import {createWriteStream} from 'node:fs'
import type {Message} from '../../client/Protobuf.js'
import {ContainerLabels, ContainerStore, type ContainerRuntimeState} from '../../client/ContainerStore.js'
import type {ContainerdClient} from '../../client/ContainerdClient.js'
import {type Containerd} from '../Containerd.js'
import {type ContainerdImage} from './ContainerdImage.js'
import type {ContainerdContainerState} from '../types/ContainerdContainerState.js'
import type {ContainerdRestartPolicy} from '../types/ContainerdRestartPolicy.js'
import type {ContainerdExecResult} from '../types/ContainerdExecResult.js'
import type {ContainerdContainerNetwork} from '../types/ContainerdContainerNetwork.js'
import type {ContainerdContainerPort} from '../types/ContainerdContainerPort.js'
import type {ContainerNetworkInterface} from '../../client/Networks.js'
import {ContainerStopOptions} from '../options/container/ContainerStopOptions.js'
import {ContainerKillOptions} from '../options/container/ContainerKillOptions.js'
import {ContainerRemoveOptions} from '../options/container/ContainerRemoveOptions.js'
import {ContainerExecOptions} from '../options/container/ContainerExecOptions.js'
import {ContainerLogsOptions} from '../options/container/ContainerLogsOptions.js'
import {ContainerdContainerNotFoundException} from '../exceptions/ContainerdContainerNotFoundException.js'
import {ContainerdError} from './ContainerdErrors.js'
import {ContainerdContainerTTY} from './ContainerdContainerTTY.js'
import {ContainerTTYOptions} from '../options/container/ContainerTTYOptions.js'
import {ContainerResourceOptions} from '../options/container/ContainerResourceOptions.js'
import {ContainerCommitOptions} from '../options/container/ContainerCommitOptions.js'
import {ContainerExportDirectoryOptions} from '../options/container/ContainerExportDirectoryOptions.js'
import type {ContainerCreateOptions} from '../options/container/ContainerCreateOptions.js'
import type {ContainerdContainerStats} from '../types/ContainerdContainerStats.js'
import {ContainerdContainerStateException} from '../exceptions/ContainerdContainerStateException.js'
import {ParseReference} from '../../client/Reference.js'

/**
 * A container of containerd
 */
@Transient()
export class ContainerdContainer extends Provider {

    readonly #abortController: AbortController = new AbortController()

    @Configurable(DTO.Function())
    protected readonly getStore: () => ContainerStore

    @Configurable(DTO.Function())
    protected readonly getClient: () => ContainerdClient

    @Configurable(DTO.Function())
    protected readonly getContainerd: () => Containerd

    /**
     * The identifier of the container (or its name, or a prefix of its identifier, resolved)
     */
    @Configurable(DTO.String())
    public id: string

    public name: string

    public hostname: string

    /**
     * The name of its image
     */
    public imageName: string

    public platform: string

    public labels: Record<string, string>

    public restartPolicy: ContainerdRestartPolicy

    public state: ContainerdContainerState

    /**
     * Its networks: host, none, or the ones of CNI
     */
    public networkNames: string[]

    /**
     * Its interfaces on its networks of CNI (their addresses while it runs)
     */
    public networks: ContainerdContainerNetwork[]

    /**
     * Its ports published on the host
     */
    public ports: ContainerdContainerPort[]

    /**
     * The names of its volumes
     */
    public volumes: string[]

    public createdAt: Time

    /**
     * The record of containerd of the container
     * @protected
     */
    protected record: Message

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await this.syncContainerInfo()
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
    }

    /**
     * Sync container info from containerd
     */
    public async syncContainerInfo(): Promise<void> {
        const record: Message | undefined = await this.getStore().find(this.id)
        if (!record) throw new ContainerdContainerNotFoundException(`The container ${this.id} does not exist`)
        this.record = record
        this.id = record.id
        this.labels = record.labels ?? {}
        this.name = ContainerStore.Name(record)
        this.hostname = this.labels[ContainerLabels.HOSTNAME] ?? ''
        this.imageName = record.image ?? ''
        this.platform = this.labels[ContainerLabels.PLATFORM] ?? ''
        this.restartPolicy = (this.labels[ContainerLabels.RESTART_POLICY] ?? 'no') as ContainerdRestartPolicy
        this.createdAt = new Time(record.createdAt ? Number(record.createdAt.seconds ?? 0) * 1000 : Date.now())
        try {
            this.networkNames = JSON.parse(this.labels[ContainerLabels.NETWORKS] ?? '[]')
        } catch {
            this.networkNames = []
        }
        this.networks = (await this.getStore().interfaces(record)).map((item: ContainerNetworkInterface): ContainerdContainerNetwork => ({
            networkName: item.network,
            interface: item.interface,
            mac: item.mac ?? '',
            ip: item.ip ?? '',
            gateway: item.gateway ?? '',
            ipPrefixLen: item.prefixLength ?? 0,
            ipv6: item.ipv6 ?? '',
            ipv6Gateway: item.ipv6Gateway ?? ''
        }))
        const ports: Map<string, ContainerdContainerPort> = new Map()
        try {
            for (const port of JSON.parse(this.labels[ContainerLabels.PORTS] ?? '[]') as { HostPort: number, ContainerPort: number, Protocol: 'tcp' | 'udp' | 'sctp', HostIP: string }[]) {
                const key: string = `${port.HostIP}/${port.ContainerPort}/${port.Protocol}`
                const known: ContainerdContainerPort = ports.get(key) ?? {host: port.HostIP, port: port.ContainerPort, type: port.Protocol, hostPorts: []}
                known.hostPorts.push(port.HostPort)
                ports.set(key, known)
            }
        } catch {
            //Not the labels of nerdctl
        }
        this.ports = [...ports.values()]
        this.volumes = ContainerStore.Volumes(record)
        const state: ContainerRuntimeState = await this.getStore().state(record)
        this.state = {
            status: state.status,
            running: state.running,
            paused: state.paused,
            restarting: state.status === 'restarting',
            pid: state.pid,
            exitCode: state.exitCode,
            startedAt: state.startedAt ? new Time(state.startedAt) : null,
            finishedAt: state.finishedAt ? new Time(state.finishedAt) : null
        }
    }

    /**
     * Run an operation of the container, its info synced after
     * @param operation
     * @protected
     */
    protected async operate<T>(operation: (record: Message) => Promise<T>): Promise<T> {
        try {
            return await operation(this.record)
        } catch (error: unknown) {
            throw ContainerdError(error)
        } finally {
            await this.syncContainerInfo().catch((): undefined => undefined)
        }
    }

    /**
     * The image of the container
     */
    public async image(): Promise<ContainerdImage> {
        return await this.getContainerd().getImage(this.imageName)
    }

    /**
     * Start container
     */
    public async start(): Promise<void> {
        await this.operate((record: Message): Promise<number> => this.getStore().start(record))
    }

    /**
     * Stop container
     * @param options
     */
    @Accept(ContainerStopOptions.optional())
    public async stop(options?: ContainerStopOptions): Promise<void> {
        if (!options) return await this.stop({})
        await this.operate((record: Message): Promise<void> => this.getStore().stop(record, {timeout: options.timeout, signal: options.signal}))
    }

    /**
     * Restart container
     * @param options
     */
    @Accept(ContainerStopOptions.optional())
    public async restart(options?: ContainerStopOptions): Promise<void> {
        if (!options) return await this.restart({})
        await this.stop(options)
        await this.start()
    }

    /**
     * Kill container
     * @param options
     */
    @Accept(ContainerKillOptions.optional())
    public async kill(options?: ContainerKillOptions): Promise<void> {
        if (!options) return await this.kill({})
        await this.operate((record: Message): Promise<void> => this.getStore().kill(record, options.signal, options.all))
    }

    /**
     * Pause container
     */
    public async pause(): Promise<void> {
        await this.operate((record: Message): Promise<void> => this.getStore().pause(record))
    }

    /**
     * Unpause container
     */
    public async unpause(): Promise<void> {
        await this.operate((record: Message): Promise<void> => this.getStore().resume(record))
    }

    /**
     * Wait for the container to exit: its exit code
     */
    public async wait(): Promise<number> {
        try {
            const {exitStatus} = await this.getClient().wait(this.id, '', this.#abortController.signal)
            return exitStatus
        } catch (error: unknown) {
            throw ContainerdError(error)
        } finally {
            await this.syncContainerInfo().catch((): undefined => undefined)
        }
    }

    /**
     * Remove container: its snapshot, its logs
     * @param options
     */
    @Accept(ContainerRemoveOptions.optional())
    public async remove(options?: ContainerRemoveOptions): Promise<void> {
        if (!options) return await this.remove({})
        try {
            await this.getStore().remove(this.record, !!options.force)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }

    /**
     * Execute a command in the running container
     * @param options
     */
    @Accept(ContainerExecOptions.required())
    public async exec(options: ContainerExecOptions): Promise<ContainerdExecResult> {
        try {
            return await this.getStore().exec(this.record, {
                cmd: typeof options.cmd === 'string' ? ['/bin/sh', '-c', options.cmd] : options.cmd,
                env: options.env,
                workingDir: options.workingDir,
                user: options.user,
                stdin: options.stdin,
                timeout: options.timeout
            })
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }

    /**
     * The logs of the container (its standard output and its error), followed while it runs
     * @param options
     */
    @Accept(ContainerLogsOptions.optional())
    public async logs(options?: ContainerLogsOptions): Promise<Readable> {
        if (!options) return await this.logs({})
        return this.getStore().logs(this.record, {tail: options.tail, follow: options.follow, signal: this.#abortController.signal})
    }

    /**
     * The resources the running container uses (its use of the CPUs during the interval of the sampling)
     * @param interval milliseconds between its two samples
     */
    @Accept(DTO.Number().integer().min(0).optional())
    public async stats(interval: number = 1000): Promise<ContainerdContainerStats> {
        try {
            return await this.getStore().stats(this.record, interval)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }

    /**
     * Open a terminal in the running container (a shell by default)
     * @param options
     */
    @Accept(ContainerTTYOptions.optional())
    public async createTTY(options?: ContainerTTYOptions): Promise<ContainerdContainerTTY> {
        return await this.getObject(ContainerdContainerTTY, {
            getStore: this.getStore,
            getRecord: (): Message => this.record,
            cmd: options?.cmd ?? '/bin/sh',
            initialConsoleSize: options?.consoleSize,
            env: options?.env,
            workingDir: options?.workingDir,
            user: options?.user
        })
    }

    /**
     * Update the container: its resources and its restart policy while it runs (docker update); the other settings by
     * creating it again with them (its name kept, started again when it runs)
     * @param options
     */
    @Accept(DTO.Object().required())
    public async update(options: Partial<ContainerCreateOptions>): Promise<void> {
        const keys: string[] = Object.keys(options).filter((key: string): boolean => options[key] !== undefined)
        const resourceKeys: string[] = ['memoryLimit', 'memorySwap', 'cpus', 'cpuShares', 'cpuSet', 'pidsLimit', 'OOMKillDisable', 'restartPolicy']
        if (keys.every((key: string): boolean => resourceKeys.includes(key))) {
            const resources: ContainerResourceOptions = ContainerResourceOptions.validate(options)
            await this.operate((record: Message): Promise<void> => this.getStore().updateResources(record, {
                memory: resources.memoryLimit,
                memorySwap: resources.memorySwap,
                cpus: resources.cpus,
                cpuShares: resources.cpuShares,
                cpuset: resources.cpuSet ? resources.cpuSet.join(',') : undefined,
                pidsLimit: resources.pidsLimit,
                oomKillDisable: resources.OOMKillDisable,
                restart: resources.restartPolicy
            }))
            //Kept by its settings: the ones it is created again with
            const current: Partial<ContainerCreateOptions> | undefined = await this.getStore().readSettings(this.id)
            if (current) await this.getStore().writeSettings(this.id, {...current, ...Object.fromEntries(keys.map((key: string): [string, unknown] => [key, options[key]]))})
            return
        }
        const settings: Partial<ContainerCreateOptions> | undefined = await this.getStore().readSettings(this.id)
        if (!settings) throw new ContainerdContainerStateException(`The container ${this.name} was not created by the component (its settings are unknown): create it again`)
        this.id = (await this.getContainerd().recreateContainer(this.record, {...settings, ...options, name: options.name ?? this.name} as ContainerCreateOptions)).id
        await this.syncContainerInfo()
    }

    /**
     * Commit the container: the changes of its file system as a new image
     * @param options
     */
    @Accept(ContainerCommitOptions.optional())
    public async commit(options?: ContainerCommitOptions): Promise<ContainerdImage> {
        if (!options) return await this.commit({})
        let name: string
        if (options.repoTag) {
            name = options.repoTag
        } else {
            const reference = ParseReference(this.imageName)
            name = `${reference.registry}/${reference.repository}:commit-${Date.now()}`
        }
        try {
            name = await this.getStore().commit(this.record, {
                name: name,
                pause: options.pauseBeforeCommitting,
                changes: options.changes ? {...options.changes, env: options.changes.env ? Object.entries(options.changes.env).map(([key, value]): string => `${key}=${value}`) : undefined} : undefined,
                comment: options.comment,
                author: options.author
            })
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
        return await this.getContainerd().getImage(name)
    }

    /**
     * Export a path of the file system of the container (its mounts with it while it runs) as a tar archive
     * @param options
     */
    @Accept(ContainerExportDirectoryOptions.required())
    public async exportDirectory(options: ContainerExportDirectoryOptions): Promise<void> {
        try {
            await this.getStore().archive(this.record, options.path, typeof options.destination === 'string' ? createWriteStream(options.destination) : options.destination)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }

    /**
     * The processes of the container (their identifiers on the host)
     */
    public async processes(): Promise<number[]> {
        try {
            return await this.getClient().listPids(this.id)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }
}
