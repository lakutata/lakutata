import {Configurable, Model} from '../../Lakutata'
import {CreateProjectDTO} from '../dtos/CreateProjectDTO'

export class ProjectCreator extends Model {

    @Configurable({
        onSet: () => {
            console.log('onset')
        }, accept: CreateProjectDTO.schema(), acceptOptions: {stripUnknown: true}
    })
    protected declare readonly options: CreateProjectDTO

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        console.log(this.options)
    }
}
