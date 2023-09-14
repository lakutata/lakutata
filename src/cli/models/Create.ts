import {Configurable, Inject, Model} from '../../Lakutata'
import {CreateProjectDTO} from '../dtos/CreateProjectDTO'
import {DeGitPuller} from '../components/DeGitPuller'

export class Create extends Model {

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Configurable({accept: CreateProjectDTO, acceptOptions: {stripUnknown: true}})
    protected readonly options: CreateProjectDTO

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        console.log(this.options)
    }
}
