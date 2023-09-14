import {Model} from '../../lib/base/Model'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators'
import {InitProjectDTO} from '../dtos/InitProjectDTO'
import {DeGitPuller} from '../components/DeGitPuller'
import path from 'path'
import {ProjectType} from '../enums/ProjectType'

export class Init extends Model {

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Configurable({accept: InitProjectDTO, acceptOptions: {stripUnknown: true}})
    protected declare readonly options: InitProjectDTO

    /**
     * 创建项目操作所在的工作目录
     * @protected
     */
    protected initWorkingDirectory: string

    /**
     * Lakutata模板的分支名
     * @protected
     */
    protected branch: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.initWorkingDirectory = path.isAbsolute(this.options.path) ? this.options.path : path.resolve(process.cwd(), this.options.path)
        this.branch = this.options.type
        this.branch = this.branch === ProjectType.plain ? 'main' : this.branch
    }
}
