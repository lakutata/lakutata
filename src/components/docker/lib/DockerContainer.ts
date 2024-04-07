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

    // public ports

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
            this.createdAt = new Time(inspectInfo.Created)
            //TODO
            // console.log(inspectInfo)
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
