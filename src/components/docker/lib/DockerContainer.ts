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

@Transient()
export class DockerContainer extends Provider {

    readonly #abortController: AbortController = new AbortController()

    #container: Dockerode.Container

    @Configurable(DTO.InstanceOf(Dockerode))
    protected readonly $dockerode: Dockerode

    @Configurable(DTO.Function())
    protected readonly getDocker: () => Docker

    @Configurable(DTO.String())
    public id: string

    public name: string

    public image: DockerImage

    public restartCount: number

    public state: ContainerState

    public ports: ContainerPort[]

    public networks: ContainerNetwork[]

    public createdAt: Time

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#container = this.$dockerode.getContainer(this.id)
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
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }

    public async start() {
        //TODO
        throw new Error('not implemented')
    }

    public async stop() {
        //TODO
        throw new Error('not implemented')
    }

    public async pause() {
        //TODO
        throw new Error('not implemented')
    }

    public async unpause() {
        //TODO
        throw new Error('not implemented')
    }

    public async restart() {
        //TODO
        throw new Error('not implemented')
    }

    public async commit() {
        //TODO
        throw new Error('not implemented')
    }

    public async remove() {
        //TODO
        throw new Error('not implemented')
    }

    public async tty() {
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

    public async kill() {
        //TODO
        throw new Error('not implemented')
    }

    public async update() {
        //TODO
        throw new Error('not implemented')
    }
}
