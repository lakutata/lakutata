import {Model} from '../../lib/base/Model'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators'
import {InitProjectDTO} from '../dtos/InitProjectDTO'
import {DeGitPuller} from '../components/DeGitPuller'

export class Init extends Model {

    @Inject('puller')
    protected readonly puller: DeGitPuller

    // @Configurable({accept: InitProjectDTO, acceptOptions: {stripUnknown: true}})
    protected declare readonly options: InitProjectDTO

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        console.info('init....')
    }
}
