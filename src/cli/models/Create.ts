import {Configurable, Inject, Model} from '../../Lakutata'
import {DeGitPuller} from '../components/DeGitPuller'
import path from 'path'
import {ProjectType} from '../enums/ProjectType'
import {Exists} from '../../Helper'
import {ProjectCompleteInformationOptions} from '../options/ProjectCompleteInformationOptions'
import {Spinner} from '../components/Spinner'
import chalk from 'chalk'
import {ProjectInformationUpdater} from '../objects/ProjectInformationUpdater'
import {execa} from 'execa'

export class Create extends Model {

    @Inject('spinner')
    protected readonly spinner: Spinner

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Configurable({accept: ProjectCompleteInformationOptions, acceptOptions: {stripUnknown: true}})
    protected readonly options: ProjectCompleteInformationOptions

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
     */
    public async exec(): Promise<void> {
        const targetPath: string = path.resolve(this.createWorkingDirectory, `./${this.options.name}`)
        if (await Exists(targetPath)) throw new Error('Target path already exists, unable to perform create operation.')
        this.spinner.start('Creating the project')
        await this.puller.pull(this.branch, targetPath)
        const updater: ProjectInformationUpdater = await this.module.get<ProjectInformationUpdater>('updater', {workingDirectory: targetPath})
        await updater.updateProjectInfo(this.options)
        await execa('npm', ['install'], {cwd: targetPath})
        this.spinner.stop()
        console.info(chalk.green('The project has been successfully created.'))
    }
}
