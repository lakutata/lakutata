import {Provider} from '../../../lib/core/Provider.js'
import {Transient} from '../../../decorators/di/Lifetime.js'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/core/DTO.js'
import Dockerode from 'dockerode'
import {IsAbortError} from '../../../lib/functions/IsAbortError.js'
import {Time} from '../../../lib/core/Time.js'

@Transient()
export class DockerContainer extends Provider {

    readonly #abortController: AbortController = new AbortController()

    #container: Dockerode.Container

    @Configurable(DTO.InstanceOf(Dockerode))
    protected readonly $dockerode: Dockerode

    @Configurable(DTO.String())
    public id: string

    public name: string

    public image: string

    public restartCount: number

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
            this.image = inspectInfo.Image
            this.restartCount = inspectInfo.RestartCount
            this.createdAt = new Time(inspectInfo.Created)
            //TODO
            console.log(inspectInfo)
        } catch (e) {
            if (!IsAbortError(e)) throw e
        }
    }
}
