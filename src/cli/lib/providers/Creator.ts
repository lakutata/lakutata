import {Provider} from '../../../lib/core/Provider.js'
import {Inject} from '../../../decorators/di/Inject.js'
import {Information} from './Information.js'
import {DeGitPuller} from '../components/DeGitPuller.js'
import {Spinner} from '../components/Spinner.js'
import {CreateProjectOptions} from '../../options/CreateProjectOptions.js'
import {Accept} from '../../../decorators/dto/Accept.js'

export class Creator extends Provider {

    @Inject('spinner')
    protected readonly spinner: Spinner

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Inject('info')
    protected readonly frameworkInfo: Information

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        //TODO
    }

    /**
     * Exec create
     * @param options
     */
    @Accept(CreateProjectOptions.required())
    public async create(options: CreateProjectOptions): Promise<void> {
        this.spinner.start('test spinner')
        setTimeout(() => {
            this.spinner.stop()
        }, 10000)
    }
}
