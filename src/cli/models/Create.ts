import {Configurable, Inject, Model} from '../../Lakutata'
import {CreateProjectDTO} from '../dtos/CreateProjectDTO'
import {DeGitPuller} from '../components/DeGitPuller'
import path from 'path'
import {ProjectType} from '../enums/ProjectType'
import {Exists} from '../../Helper'

export class Create extends Model {

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Configurable({accept: CreateProjectDTO, acceptOptions: {stripUnknown: true}})
    protected readonly options: CreateProjectDTO

    /**
     * 创建项目操作所在的工作目录
     * @protected
     */
    protected createWorkingDirectory: string

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
        this.createWorkingDirectory = path.isAbsolute(this.options.path) ? this.options.path : path.resolve(process.cwd(), this.options.path)
        this.branch = this.options.type
        this.branch = this.branch === ProjectType.plain ? 'main' : this.branch
    }

    /**
     * 执行创建
     * @param options
     */
    public async exec(options: { name: string }): Promise<void> {
        const targetPath: string = path.resolve(this.createWorkingDirectory, `./${options.name}`)
        if (await Exists(targetPath)) throw new Error('Target path already exists, unable to perform create operation.')
        await this.puller.pull(this.branch, targetPath)//todo 需要加项目名称
    }
}
