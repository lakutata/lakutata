import {Model} from '../../lib/base/Model'
import {Configurable} from '../../decorators/DependencyInjectionDecorators'
import {InitProjectDTO} from '../dtos/InitProjectDTO'

export class Init extends Model {

    // @Configurable({accept: InitProjectDTO, acceptOptions: {stripUnknown: true}})
    protected declare readonly options: InitProjectDTO

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        console.log(this.options)
    }
}
