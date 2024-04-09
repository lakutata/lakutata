import {Provider} from '../../../lib/core/Provider.js'
import {Transient} from '../../../decorators/di/Lifetime.js'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/core/DTO.js'
import Dockerode from 'dockerode'
import {IsAbortError} from '../../../lib/functions/IsAbortError.js'
import {Time} from '../../../lib/core/Time.js'
import {ContainerState} from '../types/ContainerState.js'
import {As} from '../../../lib/functions/As.js'
import {type Docker} from '../Docker.js'
import {DockerImage} from './DockerImage.js'
import {ContainerNetwork} from '../types/ContainerNetwork.js'
import {ContainerPort} from '../types/ContainerPort.js'
import {ImageExposePort} from '../types/ImageExposePort.js'
import {ContainerBind} from '../types/ContainerBind.js'
import {ContainerDevice} from '../types/ContainerDevice.js'
import {Accept} from '../../../decorators/dto/Accept.js'
import {ContainerStopOptions} from '../options/container/ContainerStopOptions.js'
import {ContainerRemoveOptions} from '../options/container/ContainerRemoveOptions.js'
import {ContainerSettingOptions} from '../options/container/ContainerSettingOptions.js'
import {ContainerRestartPolicy} from '../types/ContainerRestartPolicy.js'
import {ContainerKillOptions} from '../options/container/ContainerKillOptions.js'
import {UniqueArray} from '../../../lib/functions/UniqueArray.js'
import {ParseEnvToRecord} from './ParseEnvToRecord.js'

@Transient()
export class DockerContainer extends Provider {

    readonly #abortController: AbortController = new AbortController()

    get #container(): Dockerode.Container {
        return this.$dockerode.getContainer(this.id)
    }

    @Configurable(DTO.InstanceOf(Dockerode))
    protected readonly $dockerode: Dockerode

    @Configurable(DTO.Function())
    protected readonly getDocker: () => Docker

    @Configurable(DTO.String())
    public id: string

    public name: string

    public hostname: string

    public image: DockerImage

    public restartCount: number

    public privileged: boolean

    public tty: boolean

    public env: Record<string, string>

    public memoryLimit: number

    public cpuSet: number[]

    public restartPolicy: ContainerRestartPolicy

    public OOMKillDisable: boolean

    public state: ContainerState

    public ports: ContainerPort[]

    public binds: ContainerBind[]

    public devices: ContainerDevice[]

    public networks: ContainerNetwork[]

    public createdAt: Time

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
     * Sync container info from docker
     * @protected
     */
    protected async syncContainerInfo(): Promise<void> {
        try {
            const inspectInfo: Dockerode.ContainerInspectInfo = await this.#container.inspect({abortSignal: this.#abortController.signal})
            this.createdAt = new Time(inspectInfo.Created)
            this.name = inspectInfo.Name.substring(1)
            this.hostname = inspectInfo.Config.Hostname
            this.image = await this.getDocker().getImage(inspectInfo.Image)
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
                startedAt: inspectInfo.State.StartedAt ? new Time(inspectInfo.State.StartedAt) : null,
                finishedAt: inspectInfo.State.FinishedAt ? new Time(inspectInfo.State.FinishedAt) : null
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
            this.image.config.ports?.forEach((exposePortInfo: ImageExposePort) => {
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
                    inspectInfo.NetworkSettings.Ports[portWithType]?.forEach(hostBinding => {
                        containerIpAddresses.forEach((containerIpAddress: string) => {
                            const portMapKey: string = `${containerIpAddress}_${port}_${type}`
                            if (!portMap.has(portMapKey)) portMap.set(portMapKey, [])
                            const hostPorts: number[] = portMap.get(portMapKey)!
                            hostPorts.push(parseInt(hostBinding.HostPort))
                            portMap.set(portMapKey, hostPorts)
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
            inspectInfo.Mounts.forEach((mount: any): void => {
                if (mount.Type === 'bind') {
                    binds.push({
                        hostPath: mount.Source,
                        containerPath: mount.Destination,
                        rw: mount.RW
                    })
                }
            })
            this.binds = binds
            this.devices = inspectInfo.HostConfig.Devices ? As<{
                PathOnHost: string
                PathInContainer: string
                CgroupPermissions: string
            }[]>(inspectInfo.HostConfig.Devices).map(device => ({
                hostPath: device.PathOnHost,
                containerPath: device.PathInContainer,
                cgroupPermissions: device.CgroupPermissions
            })) : []
            this.memoryLimit = inspectInfo.HostConfig.Memory ? inspectInfo.HostConfig.Memory : 0
            this.privileged = !!inspectInfo.HostConfig.Privileged
            this.restartPolicy = inspectInfo.HostConfig.RestartPolicy?.Name ? As<ContainerRestartPolicy>(inspectInfo.HostConfig.RestartPolicy.Name) : ''
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
            this.cpuSet = UniqueArray(cpuSet).sort((a: number, b: number) => a - b).filter(value => typeof value === 'number' && !isNaN(value))
            this.env = ParseEnvToRecord(inspectInfo.Config.Env)
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    /**
     * Start container
     * @param options
     */
    public async start(): Promise<void> {
        try {
            await this.#container.start({abortSignal: this.#abortController.signal})
            await this.syncContainerInfo()
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    /**
     * Stop container
     * @param options
     */
    @Accept(ContainerStopOptions.optional())
    public async stop(options?: ContainerStopOptions): Promise<void> {
        try {
            options = options ? options : {}
            const stopOptions: Dockerode.ContainerStopOptions = {
                abortSignal: this.#abortController.signal,
                signal: options.signal,
                t: options.timeout
            }
            await this.#container.stop(stopOptions)
            await this.syncContainerInfo()
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    /**
     * Pause container
     */
    public async pause(): Promise<void> {
        await this.#container.pause()
        await this.syncContainerInfo()
    }

    /**
     * Unpause container
     */
    public async unpause(): Promise<void> {
        await this.#container.unpause()
        await this.syncContainerInfo()
    }

    /**
     * Restart container
     * @param options
     */
    @Accept(ContainerStopOptions.optional())
    public async restart(options?: ContainerStopOptions): Promise<void> {
        try {
            options = options ? options : {}
            const stopOptions: Dockerode.ContainerStopOptions = {
                abortSignal: this.#abortController.signal,
                signal: options.signal,
                t: options.timeout
            }
            await this.#container.restart(stopOptions)
            await this.syncContainerInfo()
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    /**
     * Remove container
     * @param options
     */
    @Accept(ContainerRemoveOptions.optional())
    public async remove(options?: ContainerRemoveOptions): Promise<void> {
        options = options ? options : {}
        const removeOptions: Dockerode.ContainerRemoveOptions = {
            force: !!options.force,
            v: true
        }
        await this.#container.remove(removeOptions)
    }

    /**
     * Update container
     * @param options
     */
    @Accept(ContainerSettingOptions.required())
    public async update(options: ContainerSettingOptions): Promise<void> {
        const autoStart: boolean = this.state.running
        await this.remove({force: true})
        Object.keys(options).forEach((key: string) => {
            if (options[key] === undefined) delete options[key]
        })
        const createdContainer: DockerContainer = await this.getDocker().createContainer(
            this.image.id,
            this.image.platform,
            {
                name: this.name,
                hostname: this.hostname,
                privileged: this.privileged,
                env: this.env,
                tty: this.tty,
                memoryLimit: this.memoryLimit,
                cpuSet: this.cpuSet,
                restartPolicy: this.restartPolicy,
                ports: this.ports,
                binds: this.binds,
                devices: this.devices,
                networks: this.networks,//TODO 好像有问题
                OOMKillDisable: this.OOMKillDisable,
                ...options
            })
        this.id = createdContainer.id
        if (autoStart) {
            await this.start()
        } else {
            await this.syncContainerInfo()
        }
    }

    public async commit() {
        //TODO
        throw new Error('not implemented')
    }

    public async createTTY() {
        //TODO
        throw new Error('not implemented')
    }

    public async logs() {
        //TODO
        throw new Error('not implemented')
    }

    public async stats() {
        //TODO
        throw new Error('not implemented')
    }

    public async exec() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Kill container
     * @param options
     */
    @Accept(ContainerKillOptions.optional())
    public async kill(options?: ContainerKillOptions): Promise<void> {
        await this.#container.kill(options ? options : {})
        await this.syncContainerInfo()
    }
}
