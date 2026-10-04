import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import {Accept} from '@lakutata/core/decorator/dto'
import {Time} from '@lakutata/utils/Time'
import type {Readable} from 'node:stream'
import {createWriteStream} from 'node:fs'
import {type Message} from '@lakutata/grpc'
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
 * A container of the {@link Containerd} component's namespace, with the operations of a Docker container: start, stop,
 * kill, pause, exec, terminals, logs, stats, live updates or updates by recreation, commit and file export. Get it from
 * {@link Containerd.getContainer}, {@link Containerd.listContainers} or {@link Containerd.createContainer}; do not create
 * it yourself. Each call returns a new object (transient).
 *
 * Its properties are a snapshot taken when it was obtained: the operations changing the container (`start()`, `stop()`,
 * `kill()`, `pause()`, `wait()`, `update()`…) take a new one when they end, and {@link ContainerdContainer.syncContainerInfo}
 * takes one on demand. The state the container is in decides what works: `exec()`, `createTTY()` and `stats()` need it
 * running, and `remove()` refuses a running container unless forced.
 * @example
 * ```typescript
 * import {Containerd, type ContainerdContainer, type ContainerdContainerStats} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const container: ContainerdContainer = await containerd.getContainer('worker')
 * if (!container.state.running) await container.start()
 * //The last 100 lines, without following the output
 * for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)
 * const stats: ContainerdContainerStats = await container.stats()
 * console.log(stats.cpu.percent, stats.memory.usage)
 * //Live, without a restart
 * await container.update({memoryLimit: 256 * 1024 * 1024})
 * //Its stop signal, then SIGKILL after 5 seconds
 * await container.stop({timeout: 5})
 * await container.remove()
 * ```
 */
@Transient()
export class ContainerdContainer extends Provider {

    readonly #abortController: AbortController = new AbortController()

    /**
     * Gives the component's container store; set by the component.
     */
    @Configurable(DTO.Function())
    protected readonly getStore: () => ContainerStore

    /**
     * Gives the component's containerd client; set by the component.
     */
    @Configurable(DTO.Function())
    protected readonly getClient: () => ContainerdClient

    /**
     * Gives the component that created the object.
     */
    @Configurable(DTO.Function())
    protected readonly getContainerd: () => Containerd

    /**
     * The container's identifier (64 hexadecimal characters). The name or identifier prefix the object was asked with is
     * resolved to it; it changes when {@link ContainerdContainer.update} creates the container again.
     */
    @Configurable(DTO.String())
    public id: string

    /**
     * The container's name (nerdctl's `nerdctl/name` label); its identifier when it has none.
     */
    public name: string

    /**
     * The container's hostname; empty for the containers created without nerdctl's labels.
     */
    public hostname: string

    /**
     * The name of the container's image (`docker.io/library/alpine:3.20`).
     */
    public imageName: string

    /**
     * The platform of the image the container runs (`linux/arm64/v8`); empty when unknown.
     */
    public platform: string

    /**
     * The container's labels: the ones given at its creation, its image's, and nerdctl's (`nerdctl/*`).
     */
    public labels: Record<string, string>

    /**
     * The container's restart policy, applied by containerd's restart monitor; `'no'` when it has none.
     */
    public restartPolicy: ContainerdRestartPolicy

    /**
     * The container's state when the snapshot was taken: its status, its process identifier, its last exit code, and
     * when it started and finished.
     */
    public state: ContainerdContainerState

    /**
     * The networks the container joins: `['host']`, `['none']`, or the names of its CNI networks.
     */
    public networkNames: string[]

    /**
     * The container's interfaces on its CNI networks (`eth0`, `eth1`…), with their addresses while it runs.
     */
    public networks: ContainerdContainerNetwork[]

    /**
     * The container's ports published on the host, through its first CNI network.
     */
    public ports: ContainerdContainerPort[]

    /**
     * The names of the named volumes the container mounts.
     */
    public volumes: string[]

    /**
     * When the container was created.
     */
    public createdAt: Time

    /**
     * The container's record in containerd, as last read.
     * @protected
     */
    protected record: Message

    /**
     * Read the container's information.
     * @throws {ContainerdContainerNotFoundException} No container matches the identifier or name.
     * @protected
     */
    protected async init(): Promise<void> {
        await this.syncContainerInfo()
    }

    /**
     * End the log streams followed and the waits of the object.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
    }

    /**
     * Read the container's information and state again from containerd into the object's properties.
     * @throws {ContainerdContainerNotFoundException} The container no longer exists.
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
     * Run an operation on the container, then read its information again (also when the operation fails).
     * @param operation The operation, given the container's record.
     * @returns What the operation returns.
     * @throws {ContainerdContainerStateException} The container is not in the state the operation needs.
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
     * Get the container's image.
     * @returns The image.
     * @throws {ContainerdImageNotFoundException} The image was removed since the container was created.
     */
    public async image(): Promise<ContainerdImage> {
        return await this.getContainerd().getImage(this.imageName)
    }

    /**
     * Start the container: a new task of its root file system, its output appended to its log file (rotated first beyond
     * the component's `logMaxSize`), its CNI networks set up. Its restart policy applies from now on. A running container
     * is left as it is.
     * @throws {ContainerdContainerStateException} The container is paused: unpause it.
     * @throws {Error} The task cannot be created or started (the command is not found, seccomp refuses it…).
     */
    public async start(): Promise<void> {
        await this.operate((record: Message): Promise<number> => this.getStore().start(record))
    }

    /**
     * Stop the container: send its stop signal (the one of `options`, else its `stopSignal`, else `SIGTERM`), wait for it
     * to exit, then kill all its processes with `SIGKILL` when the timeout ends. Its exit code is kept, and the restart
     * monitor no longer restarts it. A paused container is resumed first; a stopped one is left as it is.
     * @param options The time to wait in seconds (10 by default) and the signal.
     */
    @Accept(ContainerStopOptions.optional())
    public async stop(options?: ContainerStopOptions): Promise<void> {
        if (!options) return await this.stop({})
        await this.operate((record: Message): Promise<void> => this.getStore().stop(record, {timeout: options.timeout, signal: options.signal}))
    }

    /**
     * Restart the container: stop it as {@link ContainerdContainer.stop} does, then start it.
     * @param options How it is stopped: the time to wait in seconds (10 by default) and the signal.
     * @throws {Error} The task cannot be started again.
     */
    @Accept(ContainerStopOptions.optional())
    public async restart(options?: ContainerStopOptions): Promise<void> {
        if (!options) return await this.restart({})
        await this.stop(options)
        await this.start()
    }

    /**
     * Send a signal to the container's main process, or to all its processes. `SIGKILL` also tells the restart monitor
     * not to restart it; other signals do not.
     * @param options The signal (`SIGKILL` by default; a name or a number) and `all`.
     * @throws {ContainerdContainerStateException} The container is not running.
     */
    @Accept(ContainerKillOptions.optional())
    public async kill(options?: ContainerKillOptions): Promise<void> {
        if (!options) return await this.kill({})
        await this.operate((record: Message): Promise<void> => this.getStore().kill(record, options.signal, options.all))
    }

    /**
     * Pause all the processes of the running container (cgroup freezer).
     * @throws {ContainerdContainerStateException} The container is not running.
     */
    public async pause(): Promise<void> {
        await this.operate((record: Message): Promise<void> => this.getStore().pause(record))
    }

    /**
     * Resume the processes of the paused container.
     * @throws {ContainerdContainerStateException} The container is not running.
     */
    public async unpause(): Promise<void> {
        await this.operate((record: Message): Promise<void> => this.getStore().resume(record))
    }

    /**
     * Wait for the container's main process to exit, as `docker wait` does. A container that is not running resolves at
     * once: with the exit code of its last run when it exited or was stopped by {@link ContainerdContainer.stop}, with
     * `0` when it was never started (or when the component did not keep its exit code: a container created by nerdctl
     * or by another `dataRoot`). The wait ends with an error when the object is destroyed.
     * @returns The exit code.
     * @throws {GRPCError} The wait was aborted (from `@lakutata/grpc`, its `code` is `CANCELLED`).
     */
    public async wait(): Promise<number> {
        try {
            return await this.getStore().wait(this.record, this.#abortController.signal)
        } catch (error: unknown) {
            throw ContainerdError(error)
        } finally {
            await this.syncContainerInfo().catch((): undefined => undefined)
        }
    }

    /**
     * Remove the container: its task, its CNI network interfaces, its record, its snapshot and its state directory (its
     * logs included). The named volumes it mounts are kept. With `force`, a running or paused container is killed first.
     * @param options `force` (false by default).
     * @throws {ContainerdContainerStateException} The container is running and `force` is not set.
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
     * Run a command in the running container and wait for it to exit, its outputs captured in memory. The process gets
     * the container's environment (with `env` added), working directory and user unless given. Its standard output and
     * error are kept apart through FIFOs (`mkfifo` of the host); without `mkfifo`, both are in `stdout`.
     * @param options The command (a string is run by `/bin/sh -c`, an array as is), `env`, `workingDir`, `user` (`name`,
     * `uid`, `name:group`), `stdin` (written then closed) and `timeout` (milliseconds, then the process is killed with
     * `SIGKILL`).
     * @returns The exit code and the outputs; a command killed by its timeout resolves with exit code `137`.
     * @throws {ContainerdContainerStateException} The container is not running (stopped or paused).
     * @throws {Error} `stdin` is given and the host has no `mkfifo`; the user is not found in the container.
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
     * Read the container's logs: its standard output and error interleaved in one stream, without timestamps, from its
     * log file (and the previous rotated file). By default the stream follows the new output while the container runs
     * (or is being restarted by the restart monitor), and ends once it stopped or when the object is destroyed.
     * @param options `tail`, the number of last lines to start with (all by default), and `follow` (true by default).
     * @returns A readable stream of buffers.
     */
    @Accept(ContainerLogsOptions.optional())
    public async logs(options?: ContainerLogsOptions): Promise<Readable> {
        if (!options) return await this.logs({})
        return this.getStore().logs(this.record, {tail: options.tail, follow: options.follow, signal: this.#abortController.signal})
    }

    /**
     * Read the resources the running or paused container uses: its cgroup counters and its network interface counters,
     * sampled twice to compute its CPU use over the interval.
     * @param interval The time between the two samples, in milliseconds; `0` takes one sample and reports a CPU use of
     * 0. 1000 by default.
     * @returns The counters of the last sample, with the CPU use over the interval.
     * @throws {ContainerdContainerStateException} The container is not running.
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
     * Open an interactive terminal in the running container: a process with a pseudo terminal (`TERM=xterm`), its input
     * and output through FIFOs (`mkfifo` of the host). Close it with {@link ContainerdContainerTTY.close} when done.
     * @param options The command (a string is run by `/bin/sh -c` as {@link ContainerdContainer.exec} runs it, an array
     * as is; `['/bin/sh']` by default, so the image needs a shell), the initial console size, `env`, `workingDir` and
     * `user`.
     * @returns The terminal, its process started.
     * @throws {ContainerdContainerStateException} The container is not running.
     * @throws {Error} The host has no `mkfifo`; the user is not found in the container.
     */
    @Accept(ContainerTTYOptions.optional())
    public async createTTY(options?: ContainerTTYOptions): Promise<ContainerdContainerTTY> {
        return await this.getObject(ContainerdContainerTTY, {
            getStore: this.getStore,
            getRecord: (): Message => this.record,
            cmd: options?.cmd ?? ['/bin/sh'],
            initialConsoleSize: options?.consoleSize,
            env: options?.env,
            workingDir: options?.workingDir,
            user: options?.user
        })
    }

    /**
     * Update the container's settings. When only resources and the restart policy change (`memoryLimit`, `memorySwap`,
     * `cpus`, `cpuShares`, `cpuSet`, `pidsLimit`, `OOMKillDisable`, `restartPolicy`), they are applied live, without a
     * restart, as `docker update` does: `0` (`[]` for `cpuSet`) removes a limit, from the running container too, and from
     * the settings it is created again with ({@link ContainerResourceOptions}). Any other setting creates the container
     * again with its creation settings and the changes: a new container with the same name (and a new identifier, which
     * this object follows), started when the old one was running; the old one is removed. The recreation only works for
     * the containers created by the component, whose settings it kept.
     * @param options The settings to change, as {@link Containerd.createContainer} takes them.
     * @throws {InvalidValueException} A live update gives a `memorySwap` (positive) to a container without a memory
     * limit, or leaves its `memorySwap` below its `memoryLimit` (from `@lakutata/core`).
     * @throws {ContainerdContainerStateException} The container must be created again but was not created by the
     * component (nerdctl's, or created by another `dataRoot`).
     * @throws {ContainerdImageNotFoundException} From the recreation, as {@link Containerd.createContainer} throws.
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
                cpuset: resources.cpuSet?.join(','),
                pidsLimit: resources.pidsLimit,
                oomKillDisable: resources.OOMKillDisable,
                restart: resources.restartPolicy
            }))
            //Kept by its settings: the ones it is created again with, a limit removed (0, []) not kept
            const current: Partial<ContainerCreateOptions> | undefined = await this.getStore().readSettings(this.id)
            if (!current) return
            const settings: Partial<ContainerCreateOptions> = {...current, ...Object.fromEntries(keys.map((key: string): [string, unknown] => [key, options[key]]))}
            if (!settings.memoryLimit) delete settings.memoryLimit
            //No swap limit: unlimited swap with a memory limit (twice the memory without memorySwap)
            if (!settings.memoryLimit) delete settings.memorySwap
            else if (settings.memorySwap === 0) settings.memorySwap = -1
            for (const key of ['cpus', 'cpuShares', 'pidsLimit'] as const) if (!settings[key]) delete settings[key]
            if (!settings.cpuSet?.length) delete settings.cpuSet
            await this.getStore().writeSettings(this.id, settings)
            return
        }
        const settings: Partial<ContainerCreateOptions> | undefined = await this.getStore().readSettings(this.id)
        if (!settings) throw new ContainerdContainerStateException(`The container ${this.name} was not created by the component (its settings are unknown): create it again`)
        this.id = (await this.getContainerd().recreateContainer(this.record, {...settings, ...options, name: options.name ?? this.name} as ContainerCreateOptions)).id
        await this.syncContainerInfo()
    }

    /**
     * Commit the container: save the changes of its root file system (not its mounts) as a new layer on its image,
     * with configuration changes, as `docker commit` does. A running container is paused meanwhile by default.
     * @param options The name of the new image (`<registry>/<repository>:commit-<milliseconds>` of the container's image
     * by default), `pauseBeforeCommitting` (true by default), the configuration `changes`, `comment` and `author`.
     * @returns The new image.
     * @throws {ContainerdImageNotFoundException} The container's image was removed.
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
     * Copy a file or directory of the container out as a tar archive, as `docker cp` does: from the running process's
     * file system (its mounts included), or from its root file system when it is not running (without its mounts). The
     * symbolic links of the path are resolved inside the container; the devices, sockets and pipes are not archived.
     * @param options The absolute path in the container, and the destination (a file path, created or replaced, or a
     * writable stream).
     * @throws {ContainerdPathNotFoundException} The path does not exist in the container.
     * @throws {Error} The archive cannot be written.
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
     * List the processes of the running container.
     * @returns Their process identifiers on the host.
     * @throws {ContainerdContainerStateException} The container is not running.
     */
    public async processes(): Promise<number[]> {
        try {
            return await this.getStore().processes(this.record)
        } catch (error: unknown) {
            throw ContainerdError(error)
        }
    }
}
