import {Configurable, Model} from '../../Lakutata'
import {CreateProjectDTO} from '../dtos/CreateProjectDTO'

export class ProjectCreator extends Model {

    @Configurable({accept: CreateProjectDTO, acceptOptions: {stripUnknown: true}})
    protected declare readonly options: CreateProjectDTO

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        console.log(this.options)
    }
}
