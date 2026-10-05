import {Provider, DTO} from '@lakutata/core'
import {Transient, Configurable} from '@lakutata/core/decorator/di'
import type {DockerClient} from '../../client/DockerClient.js'
import {DockerStreamDecoder, readMultiplexed} from '../../client/DockerStreams.js'
import {isAbortError, As, uniqueArray} from '@lakutata/utils'
import {randomBytes} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {Time} from '@lakutata/utils/Time'
import {ContainerState} from '../types/ContainerState.js'
import {type Docker} from '../Docker.js'
import {type DockerImage} from './DockerImage.js'
import {ContainerNetwork} from '../types/ContainerNetwork.js'
import {ContainerPort} from '../types/ContainerPort.js'
import {ImageExposePort} from '../types/ImageExposePort.js'
import {ContainerBind} from '../types/ContainerBind.js'
import {ContainerDevice} from '../types/ContainerDevice.js'
import {Accept} from '@lakutata/core/decorator/dto'
import {ContainerStopOptions} from '../options/container/ContainerStopOptions.js'
import {ContainerRemoveOptions} from '../options/container/ContainerRemoveOptions.js'
import {ContainerSettingOptions} from '../options/container/ContainerSettingOptions.js'
import {ContainerRestartPolicy} from '../types/ContainerRestartPolicy.js'
import {type ContainerExecResult} from '../types/ContainerExecResult.js'
import {ContainerKillOptions} from '../options/container/ContainerKillOptions.js'
import {parseEnvToRecord} from './ParseEnvToRecord.js'
import {ContainerCommitOptions} from '../options/container/ContainerCommitOptions.js'
import {parseRepositoryTag} from './ParseRepositoryTag.js'
import {ContainerCapability} from '../types/ContainerCapability.js'
import {DockerContainerTTY} from './DockerContainerTTY.js'
import {ContainerCreateTTYOptions} from '../options/container/ContainerCreateTTYOptions.js'
import {ContainerLogsOptions} from '../options/container/ContainerLogsOptions.js'
import {Writable, type Duplex} from 'node:stream'
import {ContainerStats} from '../types/ContainerStats.js'
import {ContainerExecOptions} from '../options/container/ContainerExecOptions.js'
import {ContainerExportDirectoryOptions} from '../options/container/ContainerExportDirectoryOptions.js'
import {pipeline} from 'stream/promises'
import {createWriteStream} from 'node:fs'
import {type DeviceMapping} from '../../client/types/DeviceMapping.js'
import {type IdResponse} from '../../client/types/IdResponse.js'
import {type PortBinding} from '../../client/types/PortBinding.js'
import {DockerImageNotFoundException} from '../exceptions/DockerImageNotFoundException.js'
import {DockerContainerNotFoundException} from '../exceptions/DockerContainerNotFoundException.js'
import {engineBinds, engineDevices, engineEndpoints, enginePortBindings, engineRestartPolicy, parseRestartPolicy} from './EngineSettings.js'

/**
 * A container of the Docker daemon, with its settings and its state as inspected, and its operations: start, stop,
 * restart, pause, kill, remove, update, commit, exec, TTYs, logs, stats and the export of its files. It is not created
 * with `new`: {@link Docker.getContainer}, {@link Docker.listContainers}, {@link Docker.createContainer} and
 * {@link DockerImage.run} return it.
 *
 * Its properties are a snapshot, taken when it is obtained and refreshed by its own operations (`start()`, `stop()`,
 * `restart()`, `pause()`, `unpause()`, `kill()`, `update()`): the changes made by others (the container exiting,
 * `docker stop`) are seen by getting it again. Its operations reject with {@link DockerContainerNotFoundException} when
 * the container was removed, with {@link DockerRequestException} when the daemon refuses them otherwise (not running:
 * HTTP 409), and with the network error of Node.js when the daemon cannot be reached.
 * @example
 * ```typescript
 * import {type Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image: DockerImage = await docker.getImage('alpine:3.20')
 * const container: DockerContainer = await docker.createContainer(image.id, {
 *     name: 'worker',
 *     cmd: ['sh', '-c', 'echo started; sleep 3600'],
 *     env: {MODE: 'production'},
 *     ports: [{port: 8080, type: 'tcp', hostPorts: [18080]}],
 *     binds: [{hostPath: '/srv/data', containerPath: '/data', rw: true}],
 *     restartPolicy: 'unless-stopped'
 * })
 * await container.start()
 * console.log(container.state.status, container.ports)
 * //The exit code, stdout and stderr
 * const {exitCode, stdout} = await container.exec({cmd: ['ls', '/data']})
 * console.log(exitCode, stdout)
 * await container.stop({timeout: 10})
 * await container.remove()
 * ```
 */
@Transient()
export class DockerContainer extends Provider {

    readonly #abortController: AbortController = new AbortController()

    /**
     * Give the client of the Engine API: set by the {@link Docker} component creating the object.
     */
    @Configurable(DTO.Function())
    protected readonly getClient: () => DockerClient

    /**
     * Give the {@link Docker} component which created the object.
     */
    @Configurable(DTO.Function())
    protected readonly getDocker: () => Docker

    /**
     * The full ID of the container (64 hexadecimal characters). It changes when {@link DockerContainer.update}
     * recreates the container.
     */
    @Configurable(DTO.String())
    public id: string

    /**
     * The name of the container, without the leading `/` of the Engine API.
     */
    public name: string

    /**
     * The host name of the container (its short ID unless set when it was created).
     */
    public hostname: string

    /**
     * The image the container was created from; `undefined` when it no longer exists (removed with force while the
     * container was stopped).
     */
    public image: DockerImage | undefined

    /**
     * How many times the daemon restarted the container, by its restart policy.
     */
    public restartCount: number

    /**
     * Whether the container has full access to the host (`--privileged`).
     */
    public privileged: boolean

    /**
     * Whether the container's main process has a TTY: its logs are then raw, not split into stdout and stderr.
     */
    public tty: boolean

    /**
     * The environment variables of the container, the image's included, by name.
     */
    public env: Record<string, string>

    /**
     * The memory limit of the container, in bytes; `0` for no limit.
     */
    public memoryLimit: number

    /**
     * The indexes of the CPUs the container may run on, sorted; empty for all of them.
     */
    public cpuSet: number[]

    /**
     * When the daemon restarts the container after it exits (`'no'` by default; `'on-failure:3'` for 3 retries at
     * most).
     */
    public restartPolicy: ContainerRestartPolicy

    /**
     * Whether the OOM killer is disabled for the container.
     */
    public OOMKillDisable: boolean

    /**
     * The kernel capabilities added to the container (`--cap-add`).
     */
    public capabilities: ContainerCapability[]

    /**
     * The state of the container: its status (`'created'`, `'running'`, `'exited'`…), its process ID, its exit code
     * and its start and finish times.
     */
    public state: ContainerState

    /**
     * The ports of the container, exposed by its image or published: one entry per IP address of the container, port
     * and protocol, with the ports of the host published to it, each one once (empty when not published).
     */
    public ports: ContainerPort[]

    /**
     * The directories and files of the host mounted in the container (the bind mounts; not the volumes).
     */
    public binds: ContainerBind[]

    /**
     * The devices of the host added to the container.
     */
    public devices: ContainerDevice[]

    /**
     * The networks the container is connected to, with its addresses in each.
     */
    public networks: ContainerNetwork[]

    /**
     * The cgroup the container joins (`container:<name|id>`), as the daemon reports it (an empty string by default).
     */
    public cgroup: string | undefined

    /**
     * The parent cgroup under which the container's cgroup is created (an empty string by default).
     */
    public cgroupParent: string | undefined

    /**
     * The PID namespace mode of the container: `'host'`, `'container:<name|id>'`, or an empty string for its own.
     */
    public pidMode: string | undefined

    /**
     * When the container was created.
     */
    public createdAt: Time

    /**
     * Inspect the container.
     * @throws {DockerContainerNotFoundException} When the container does not exist.
     * @protected
     */
    protected async init(): Promise<void> {
        await this.syncContainerInfo()
    }

    /**
     * Abort the requests in progress of the object (the container itself is left as it is).
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#abortController.abort()
    }

    /**
     * Refresh the properties from the daemon's inspection of the container, and its image (`undefined` when it no longer
     * exists).
     * @throws {DockerContainerNotFoundException} When the container does not exist.
     * @protected
     */
    protected async syncContainerInfo(): Promise<void> {
        try {
            const inspectInfo: Record<string, any> = await this.getClient().inspectContainer(this.id, this.#abortController.signal)
            //Got by its name or a short ID: its full ID
            this.id = inspectInfo.Id
            this.createdAt = new Time(inspectInfo.Created)
            this.name = inspectInfo.Name.substring(1)
            this.hostname = inspectInfo.Config.Hostname
            try {
                this.image = await this.getDocker().getImage(inspectInfo.Image)
            } catch (e) {
                //Its image removed with force: the container is read without it
                if (!(e instanceof DockerImageNotFoundException)) throw e
                this.image = undefined
            }
            this.restartCount = inspectInfo.RestartCount
            this.state = {
                status: As<'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead'>(inspectInfo.State.Status),
                running: inspectInfo.State.Running,
                paused: inspectInfo.State.Paused,
                restarting: inspectInfo.State.Restarting,
                OOMKilled: inspectInfo.State.OOMKilled,
                dead: inspectInfo.State.Dead,
                pid: inspectInfo.State.Pid,
                exitCode: inspectInfo.State.ExitCode,
                startedAt: this.#time(inspectInfo.State.StartedAt),
                finishedAt: this.#time(inspectInfo.State.FinishedAt)
            }
            const networkSettings: Record<string, any> = inspectInfo.NetworkSettings ? inspectInfo.NetworkSettings.Networks ? inspectInfo.NetworkSettings.Networks : {} : {}
            this.tty = inspectInfo.Config.Tty
            this.OOMKillDisable = !!inspectInfo.HostConfig.OomKillDisable
            this.networks = Object.keys(networkSettings).map((networkSettingName: string): ContainerNetwork => ({
                networkName: networkSettingName,
                networkId: networkSettings[networkSettingName].NetworkID,
                endpointId: networkSettings[networkSettingName].EndpointID,
                mac: networkSettings[networkSettingName].MacAddress,
                ip: networkSettings[networkSettingName].IPAddress,
                gateway: networkSettings[networkSettingName].Gateway,
                ipPrefixLen: networkSettings[networkSettingName].IPPrefixLen,
                ipv6: networkSettings[networkSettingName].GlobalIPv6Address,
                ipv6Gateway: networkSettings[networkSettingName].IPv6Gateway,
                ipv6PrefixLen: networkSettings[networkSettingName].GlobalIPv6PrefixLen
            }))
            const containerIpAddresses: string[] = []
            this.networks.forEach((network: ContainerNetwork): void => {
                if (network.ip) containerIpAddresses.push(network.ip)
                if (network.ipv6) containerIpAddresses.push(`[${network.ipv6}]`)
            })
            const ports: ContainerPort[] = []
            const portMap: Map<string, number[]> = new Map()
            this.image?.config.ports?.forEach((exposePortInfo: ImageExposePort) => {
                containerIpAddresses.forEach((containerIpAddress: string) => {
                    const types: ('tcp' | 'udp')[] = []
                    if (exposePortInfo.tcp) types.push('tcp')
                    if (exposePortInfo.udp) types.push('udp')
                    types.forEach(type => {
                        const portMapKey: string = `${containerIpAddress}_${exposePortInfo.port}_${type}`
                        if (!portMap.has(portMapKey)) portMap.set(portMapKey, [])
                    })
                })
            })
            if (inspectInfo.NetworkSettings.Ports) {
                Object.keys(inspectInfo.NetworkSettings.Ports).forEach((portWithType: string) => {
                    const portInfo: string[] = portWithType.split('/')
                    const port: number = parseInt(portInfo[0])
                    const type: 'tcp' | 'udp' = As<'tcp' | 'udp'>(portInfo[1].toLowerCase())
                    inspectInfo.NetworkSettings.Ports[portWithType]?.forEach((hostBinding: PortBinding) => {
                        containerIpAddresses.forEach((containerIpAddress: string) => {
                            const portMapKey: string = `${containerIpAddress}_${port}_${type}`
                            if (!portMap.has(portMapKey)) portMap.set(portMapKey, [])
                            //A host port is bound on the IPv4 and the IPv6 addresses of the host: listed once
                            const hostPorts: number[] = portMap.get(portMapKey)!
                            const hostPort: number = parseInt(hostBinding.HostPort)
                            if (!hostPorts.includes(hostPort)) hostPorts.push(hostPort)
                        })
                    })
                })
            }
            portMap.forEach((hostPorts: number[], portMapKey: string) => {
                const infos: string[] = portMapKey.split('_')
                const containerIpAddress: string = infos[0]
                const port: number = parseInt(infos[1])
                const type: 'tcp' | 'udp' = As<'tcp' | 'udp'>(infos[2])
                ports.push({
                    host: containerIpAddress,
                    port: port,
                    type: type,
                    hostPorts: hostPorts
                })
            })
            this.ports = ports
            const binds: ContainerBind[] = []
            for (const mount of inspectInfo.Mounts ?? []) {
                if (mount.Type === 'bind') {
                    binds.push({
                        hostPath: mount.Source,
                        containerPath: mount.Destination,
                        rw: mount.RW
                    })
                }
            }
            this.binds = binds
            this.devices = inspectInfo.HostConfig.Devices ? As<DeviceMapping[]>(inspectInfo.HostConfig.Devices).map(device => ({
                hostPath: device.PathOnHost,
                containerPath: device.PathInContainer,
                cgroupPermissions: device.CgroupPermissions
            })) : []
            this.memoryLimit = inspectInfo.HostConfig.Memory ? inspectInfo.HostConfig.Memory : 0
            this.privileged = !!inspectInfo.HostConfig.Privileged
            this.restartPolicy = parseRestartPolicy(inspectInfo.HostConfig.RestartPolicy)
            this.cgroup = inspectInfo.HostConfig.Cgroup
            this.cgroupParent = inspectInfo.HostConfig.CgroupParent
            this.pidMode = inspectInfo.HostConfig.PidMode
            const cpuSetString: string = inspectInfo.HostConfig.CpusetCpus ? inspectInfo.HostConfig.CpusetCpus : ''
            const cpuSetArray: string[] = cpuSetString.split(',')
            const cpuIndexesArray: number[][] = cpuSetArray.map((cpuSetItem: string) => {
                if (cpuSetItem.includes('-')) {
                    const [min, max] = cpuSetItem.split('-')
                    const cpuIndexes: number[] = []
                    if (!min || !max) return cpuIndexes
                    for (let i: number = parseInt(min); i <= parseInt(max); i++) cpuIndexes.push(i)
                    return cpuIndexes
                } else {
                    return [parseInt(cpuSetItem)]
                }
            })
            let cpuSet: number[] = []
            cpuIndexesArray.forEach((cpuIndexes: number[]): void => {
                cpuSet = [...cpuIndexes, ...cpuSet]
            })
            this.cpuSet = uniqueArray(cpuSet).sort((a: number, b: number) => a - b).filter(value => typeof value === 'number' && !isNaN(value))
            this.env = parseEnvToRecord(inspectInfo.Config.Env)
            this.capabilities = inspectInfo.HostConfig.CapAdd ? inspectInfo.HostConfig.CapAdd : []
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * The time of a date of the state: null for Docker's zero date (never)
     * @param date
     */
    #time(date?: string | null): Time | null {
        if (!date || date.startsWith('0001-01-01')) return null
        return new Time(date)
    }

    /**
     * Start the container, as `docker start`, then refresh its properties. A container already running is left as it is
     * (as the Docker CLI does).
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When it fails to start (HTTP 500: a command not found, a port already used).
     */
    public async start(): Promise<void> {
        try {
            await this.getClient().startContainer(this.id, this.#abortController.signal)
            await this.syncContainerInfo()
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * Stop the container, as `docker stop`: send its stop signal, wait for it to exit, kill it after the timeout; then
     * refresh its properties.
     * @param options The signal sent (the container's stop signal, `SIGTERM` by default) and the timeout before the kill,
     * in seconds (the container's, 10 by default). A container already stopped is left as it is (as the Docker CLI does).
     * @throws {DockerContainerNotFoundException} When the container was removed.
     */
    @Accept(ContainerStopOptions.optional())
    public async stop(options?: ContainerStopOptions): Promise<void> {
        if (!options) return await this.stop({})
        try {
            await this.getClient().stopContainer(this.id, {signal: options.signal, t: options.timeout}, this.#abortController.signal)
            await this.syncContainerInfo()
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * Suspend the processes of the container, as `docker pause`, then refresh its properties.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When it is not running or already paused (HTTP 409).
     */
    public async pause(): Promise<void> {
        await this.getClient().pauseContainer(this.id)
        await this.syncContainerInfo()
    }

    /**
     * Resume the processes of a paused container, as `docker unpause`, then refresh its properties.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When it is not paused (HTTP 409).
     */
    public async unpause(): Promise<void> {
        await this.getClient().unpauseContainer(this.id)
        await this.syncContainerInfo()
    }

    /**
     * Restart the container, as `docker restart`: stop it as {@link DockerContainer.stop} does (when it runs), then start
     * it; then refresh its properties.
     * @param options The signal sent (the container's stop signal, `SIGTERM` by default) and the timeout before the kill,
     * in seconds (the container's, 10 by default).
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When it fails to start (HTTP 500).
     */
    @Accept(ContainerStopOptions.optional())
    public async restart(options?: ContainerStopOptions): Promise<void> {
        if (!options) return await this.restart({})
        try {
            await this.getClient().restartContainer(this.id, {signal: options.signal, t: options.timeout}, this.#abortController.signal)
            await this.syncContainerInfo()
        } catch (e) {
            if (!isAbortError(e)) throw e
        }
    }

    /**
     * Remove the container, as `docker rm -v`: its anonymous volumes are removed with it. The object is not refreshed:
     * its other operations then fail with {@link DockerContainerNotFoundException}.
     * @param options `force` kills a running container first (`false` by default).
     * @throws {DockerContainerNotFoundException} When the container was already removed.
     * @throws {DockerRequestException} When it is running and `force` is not set (HTTP 409).
     */
    @Accept(ContainerRemoveOptions.optional())
    public async remove(options?: ContainerRemoveOptions): Promise<void> {
        if (!options) return await this.remove({})
        await this.getClient().removeContainer(this.id, {force: !!options.force, v: true})
    }

    /**
     * Change the settings of the container, keeping the others. The memory limit, the CPUs and the restart policy are
     * changed live, as `docker update` does, and the name by renaming it, the container running on. The other
     * settings (and removing the memory limit or the CPU set, which Docker cannot do live) recreate the container: a new
     * one is created from the old one's whole configuration (its image, command, entrypoint, environment, mounts,
     * networks and their static addresses, the addresses Docker assigned being assigned again), with the settings
     * changed, under a temporary name. Once created (and, when the old one was running, the old one stopped and the new
     * one started), the old one is removed without its volumes and the new one takes its name (and its anonymous
     * volumes, mounted again). The object follows the new container: its `id` changes.
     * @remarks The old container is kept when the creation or the start of the new one fails (invalid settings, the
     * image removed, a network missing): the new one is removed, the old one started again when it was running, and the
     * call rejects. Its files outside the volumes are not kept by a recreation (commit them first, see
     * {@link DockerContainer.commit}). A container removed by Docker when it stops (`AutoRemove`) cannot be kept.
     * @param options The settings changed: `memoryLimit`, `cpuSet` and `restartPolicy` live (the swap limit set to
     * Docker's default with the memory), `name` by a renaming; `hostname`, `env` (replacing the container's variables;
     * the image's are added again), `cmd`, `entrypoint`, `tty`, `privileged`, `ports`, `binds` (replacing the bind
     * mounts, the volumes kept), `devices`, `networks` (replacing the networks), `capabilities`, `OOMKillDisable`,
     * `cgroup`, `cgroupParent` and `pidMode` by a recreation. The settings absent are kept.
     * @throws {InvalidMethodAcceptException} When the settings are invalid.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerImageNotFoundException} When the container must be recreated and its image no longer exists.
     * @throws {DockerNetworkNotFoundException} When a network of the settings is not found.
     * @throws {DockerRequestException} When the daemon refuses the changes: a limit refused (HTTP 400), the name
     * already used (HTTP 409), the new container failing to start (HTTP 500).
     */
    @Accept(ContainerSettingOptions.required())
    public async update(options: ContainerSettingOptions): Promise<void> {
        const changes: ContainerSettingOptions = As<ContainerSettingOptions>(Object.fromEntries(Object.entries(options).filter(([, value]: [string, unknown]): boolean => value !== undefined)))
        const inspectInfo: Record<string, any> = await this.getClient().inspectContainer(this.id)
        const name: string = changes.name ?? inspectInfo.Name.substring(1)
        //The resources Docker sets live (it cannot remove a limit live), and the restart policy
        const resources: Record<string, unknown> = {}
        let recreated: boolean = false
        for (const key of Object.keys(changes)) {
            if (key === 'name') continue
            //No limit to remove
            if ((key === 'memoryLimit' && !changes.memoryLimit && !inspectInfo.HostConfig.Memory) || (key === 'cpuSet' && !changes.cpuSet!.length && !inspectInfo.HostConfig.CpusetCpus)) continue
            if (key === 'memoryLimit' && changes.memoryLimit) {
                resources.Memory = changes.memoryLimit
                //As much swap as memory, Docker's default, unless the swap is unlimited
                if (inspectInfo.HostConfig.MemorySwap !== -1) resources.MemorySwap = changes.memoryLimit * 2
            } else if (key === 'cpuSet' && changes.cpuSet!.length) {
                resources.CpusetCpus = changes.cpuSet!.join(',')
            } else if (key === 'restartPolicy') {
                resources.RestartPolicy = engineRestartPolicy(changes.restartPolicy || 'no')
            } else {
                recreated = true
            }
        }
        if (recreated) {
            await this.#recreate(inspectInfo, changes, name)
        } else {
            if (Object.keys(resources).length) await this.getClient().updateContainer(this.id, resources)
            if (name !== inspectInfo.Name.substring(1)) await this.getClient().renameContainer(this.id, name)
        }
        await this.syncContainerInfo()
    }

    /**
     * Recreate the container from its configuration, with the settings changed: created under a temporary name, it
     * replaces the old one once created
     * @param inspectInfo The inspection of the container
     * @param changes The settings changed
     * @param name The name of the container
     */
    async #recreate(inspectInfo: Record<string, any>, changes: ContainerSettingOptions, name: string): Promise<void> {
        const config: Record<string, any> = {...inspectInfo.Config}
        const hostConfig: Record<string, any> = {...inspectInfo.HostConfig}
        //By its ID: the name it was created with may be another image's now
        config.Image = inspectInfo.Image
        //The host name Docker gave (the short ID), or the one of the container whose network it shares, is not kept
        if (config.Hostname === inspectInfo.Id.substring(0, 12) || /^container:/.test(hostConfig.NetworkMode ?? '')) delete config.Hostname
        if (changes.hostname !== undefined) config.Hostname = changes.hostname
        if (changes.tty !== undefined) config.Tty = changes.tty
        if (changes.env) config.Env = Object.keys(changes.env).map((envKey: string): string => `${envKey}=${changes.env![envKey]}`)
        if (changes.cmd) config.Cmd = changes.cmd
        if (changes.entrypoint) config.Entrypoint = changes.entrypoint
        if (changes.privileged !== undefined) hostConfig.Privileged = changes.privileged
        if (changes.memoryLimit !== undefined) {
            hostConfig.Memory = changes.memoryLimit
            //Docker's default swap, unless the swap is unlimited
            if (hostConfig.MemorySwap !== -1) hostConfig.MemorySwap = 0
        }
        if (changes.cpuSet) hostConfig.CpusetCpus = changes.cpuSet.join(',')
        if (changes.restartPolicy !== undefined) hostConfig.RestartPolicy = engineRestartPolicy(changes.restartPolicy || 'no')
        if (changes.OOMKillDisable !== undefined) hostConfig.OomKillDisable = changes.OOMKillDisable
        if (changes.capabilities) hostConfig.CapAdd = changes.capabilities
        if (changes.cgroup !== undefined) hostConfig.Cgroup = changes.cgroup
        if (changes.cgroupParent !== undefined) hostConfig.CgroupParent = changes.cgroupParent
        if (changes.pidMode !== undefined) hostConfig.PidMode = changes.pidMode
        if (changes.devices) hostConfig.Devices = engineDevices(changes.devices)
        if (changes.ports) {
            hostConfig.PortBindings = enginePortBindings(changes.ports)
            config.ExposedPorts = {...config.ExposedPorts, ...Object.fromEntries(Object.keys(hostConfig.PortBindings).map((port: string): [string, object] => [port, {}]))}
        } else {
            //Each host port once
            hostConfig.PortBindings = Object.fromEntries(Object.entries(hostConfig.PortBindings ?? {}).map(([port, bindings]: [string, any]): [string, PortBinding[] | null] => [
                port,
                bindings ? bindings.filter((binding: PortBinding, index: number): boolean => bindings.findIndex((other: PortBinding): boolean => other.HostIp === binding.HostIp && other.HostPort === binding.HostPort) === index) : null
            ]))
        }
        if (changes.binds) {
            //The bind mounts replaced (their source is a host path), the volumes kept
            hostConfig.Binds = [...(hostConfig.Binds ?? []).filter((bind: string): boolean => !/^(\/|[a-zA-Z]:\\)/.test(bind)), ...engineBinds(changes.binds)]
            hostConfig.Mounts = (hostConfig.Mounts ?? []).filter((mount: Record<string, any>): boolean => mount.Type !== 'bind')
        }
        //The anonymous volumes mounted again by their names: the old container is removed without them
        const mounted: string[] = [
            ...(hostConfig.Binds ?? []).map((bind: string): string => bind.split(':')[1]),
            ...(hostConfig.Mounts ?? []).map((mount: Record<string, any>): string => mount.Target)
        ]
        const anonymousVolumes: Record<string, any>[] = (inspectInfo.Mounts ?? []).filter((mount: Record<string, any>): boolean => mount.Type === 'volume' && !mounted.includes(mount.Destination))
        if (anonymousVolumes.length) hostConfig.Mounts = [...(hostConfig.Mounts ?? []), ...anonymousVolumes.map((mount: Record<string, any>): Record<string, unknown> => ({
            Type: 'volume',
            Source: mount.Name,
            Target: mount.Destination,
            ReadOnly: !mount.RW
        }))]
        let endpoints: Record<string, Record<string, unknown>>
        if (changes.networks) {
            endpoints = engineEndpoints(changes.networks)
            if (changes.networks.length && !/^(host|none|container:)/.test(hostConfig.NetworkMode ?? '')) hostConfig.NetworkMode = changes.networks[0].networkName
        } else {
            //The networks kept as configured: their static addresses only (IPAMConfig), the others assigned again
            const networks: Record<string, Record<string, any>> = inspectInfo.NetworkSettings?.Networks ?? {}
            endpoints = Object.fromEntries(Object.entries(networks).map(([networkName, endpoint]: [string, Record<string, any>]): [string, Record<string, unknown>] => [networkName, {
                IPAMConfig: endpoint.IPAMConfig ?? undefined,
                Links: endpoint.Links ?? undefined,
                Aliases: endpoint.Aliases?.filter((alias: string): boolean => alias !== inspectInfo.Id.substring(0, 12)) ?? undefined,
                DriverOpts: endpoint.DriverOpts ?? undefined,
                GwPriority: endpoint.GwPriority
            }]))
        }
        //The platform of the image used: an image may have several
        const platform: Record<string, string> | undefined = inspectInfo.ImageManifestDescriptor?.platform
        const created: IdResponse = await this.getClient().createContainer({
            ...config,
            HostConfig: hostConfig,
            NetworkingConfig: {EndpointsConfig: endpoints}
        }, {
            name: `${name}-update-${randomBytes(4).toString('hex')}`,
            platform: platform?.os && platform.architecture ? [platform.os, platform.architecture, platform.variant].filter(Boolean).join('/') : undefined
        })
        //Created: the old container is replaced once the new one runs (its ports and addresses freed by the old one), and
        //is kept, started again, when the new one cannot start or the old one cannot be removed
        const running: boolean = !!inspectInfo.State?.Running
        try {
            if (running) {
                await this.getClient().stopContainer(this.id)
                await this.getClient().startContainer(created.Id)
            }
            await this.getClient().removeContainer(this.id, {force: true, v: false}).catch((error: unknown): void => {
                //Removed by itself once stopped (AutoRemove)
                if (!(error instanceof DockerContainerNotFoundException)) throw error
            })
        } catch (e) {
            await this.getClient().removeContainer(created.Id, {force: true, v: false}).catch((): void => undefined)
            if (running) await this.getClient().startContainer(this.id).catch((): void => undefined)
            throw e
        }
        this.id = created.Id
        await this.getClient().renameContainer(this.id, name)
    }

    /**
     * Create an image from the container's current files, as `docker commit`.
     * @param options The name of the image (`repoTag`, `repo:tag`; none by default) and whether the container is paused
     * while it is committed (`pauseBeforeCommitting`, `true` by default).
     * @returns The image created.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     */
    @Accept(ContainerCommitOptions.optional().default({}))
    public async commit(options?: ContainerCommitOptions): Promise<DockerImage> {
        if (!options) return await this.commit({})
        let repo: string | undefined = undefined
        let tag: string | undefined = undefined
        if (options.repoTag) {
            const parseResult = parseRepositoryTag(options.repoTag)
            repo = parseResult.repo
            tag = parseResult.tag
        }
        const commitResult: IdResponse = await this.getClient().commitContainer(this.id, {
            repo: repo,
            tag: tag,
            pause: options.pauseBeforeCommitting !== undefined ? options.pauseBeforeCommitting : true
        })
        return await this.getDocker().getImage(commitResult.Id)
    }

    /**
     * Start an interactive command with a TTY in the running container, as `docker exec -it`. The command runs until it
     * exits (or its stream is closed): see {@link DockerContainerTTY}.
     * @param options The command (`['/bin/sh']` by default; the program and its arguments, run as they are, or a command
     * line, run by `/bin/sh -c`) and the initial console size.
     * @returns The TTY, its command started.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When the container is not running (HTTP 409).
     */
    @Accept(ContainerCreateTTYOptions.optional())
    public async createTTY(options?: ContainerCreateTTYOptions): Promise<DockerContainerTTY> {
        return await this.getObject(DockerContainerTTY, {
            getClient: this.getClient,
            containerId: this.id,
            cmd: typeof options?.cmd === 'string' ? ['/bin/sh', '-c', options.cmd] : options?.cmd ?? ['/bin/sh'],
            initialConsoleSize: options?.consoleSize
        })
    }

    /**
     * Read the logs of the container's main process, as `docker logs`: stdout and stderr in one stream, in their order
     * (split from Docker's multiplexed format unless the container has a TTY).
     * @remarks The logs are followed by default: the stream does not end while the container runs. Pass `follow: false`
     * for the logs written so far.
     * @param options `follow` (`true` by default), `since` and `until` (UNIX timestamps in seconds; `0`, no bound, by
     * default), `timestamps` (`false` by default) and `tail` (a number of lines from the end; all by default).
     * @returns The readable stream of the logs.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     */
    @Accept(ContainerLogsOptions.optional())
    public async logs(options?: ContainerLogsOptions): Promise<NodeJS.ReadableStream> {
        if (!options) return await this.logs({})
        const logs: NodeJS.ReadableStream = await this.getClient().containerLogs(this.id, {
            follow: !!options.follow,
            stdout: true,
            stderr: true,
            since: options.since,
            until: options.until,
            timestamps: options.timestamps,
            tail: options.tail
        })
        //The logs of a container without TTY are multiplexed: their contents are given, in their order
        if (this.tty) return logs
        const decoder: DockerStreamDecoder = new DockerStreamDecoder()
        logs.once('error', (error: Error): unknown => decoder.destroy(error))
        return logs.pipe(decoder)
    }

    /**
     * Read the resource usage of the container once, as `docker stats --no-stream`: CPU, memory, network, block I/O and
     * processes, as the Engine API reports them.
     * @returns The statistics.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     */
    public async stats(): Promise<ContainerStats> {
        return await this.getClient().containerStats(this.id) as ContainerStats
    }

    /**
     * Run a command in the running container, as `docker exec` (no TTY, no stdin), and wait for it to exit. As the
     * containerd component's, a command exiting with a non-zero code resolves too: check its `exitCode`.
     * @param options The command: a program and its arguments (`['ls', '-l']`), run as they are, or a command line
     * (`'ls /data | wc -l'`), run by `/bin/sh -c`.
     * @returns The exit code of the command, its stdout and its stderr (a program not found: exit code `127` or `126`,
     * the error in the output).
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When the container is not running or paused (HTTP 409).
     */
    @Accept(ContainerExecOptions.required())
    public async exec(options: ContainerExecOptions): Promise<ContainerExecResult> {
        const exec: IdResponse = await this.getClient().createExec(this.id, {
            Cmd: typeof options.cmd === 'string' ? ['/bin/sh', '-c', options.cmd] : options.cmd,
            AttachStdout: true,
            AttachStderr: true
        })
        //Without TTY, the output is multiplexed: stdout and stderr apart
        const duplex: Duplex = await this.getClient().startExec(exec.Id, {Detach: false, Tty: false})
        const {stdout, stderr} = await readMultiplexed(duplex)
        //The exit code is set once the process is reaped, which may follow the end of its output
        let inspectInfo: Record<string, any> = await this.getClient().inspectExec(exec.Id)
        for (let attempt: number = 0; (inspectInfo.Running || inspectInfo.ExitCode === null) && attempt < 200; attempt++) {
            await sleep(10)
            inspectInfo = await this.getClient().inspectExec(exec.Id)
        }
        return {exitCode: inspectInfo.ExitCode ?? 0, stdout: stdout, stderr: stderr}
    }

    /**
     * Send a signal to the container's main process, as `docker kill` (`SIGKILL` by default), then refresh its properties.
     * @param options The signal sent: a name (`'SIGHUP'`) or a number (`1`); `SIGKILL` by default.
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When the container is not running (HTTP 409), or the signal is unknown.
     */
    @Accept(ContainerKillOptions.optional())
    public async kill(options?: ContainerKillOptions): Promise<void> {
        if (!options) return await this.kill({})
        await this.getClient().killContainer(this.id, {signal: options.signal === undefined ? undefined : String(options.signal)})
        await this.syncContainerInfo()
    }

    /**
     * Copy a file or a directory out of the container as a tar archive, as `docker cp container:path -`. The container
     * may be stopped.
     * @param options The path in the container, and the `destination` of the archive: a file path (created or
     * overwritten) or a writable stream (ended after the archive).
     * @throws {DockerContainerNotFoundException} When the container was removed.
     * @throws {DockerRequestException} When the path is not found in the container (HTTP 404).
     * @throws {Error} The error of the destination.
     */
    @Accept(ContainerExportDirectoryOptions.required())
    public async exportDirectory(options: ContainerExportDirectoryOptions): Promise<void> {
        const readableStream: NodeJS.ReadableStream = await this.getClient().getArchive(this.id, {path: options.path})
        const writableStream: Writable = typeof options.destination === 'string' ? createWriteStream(options.destination) : options.destination
        await pipeline(readableStream, writableStream)
    }
}
