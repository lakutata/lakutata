import {Model} from '../../lib/base/Model'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators'
import {DeGitPuller} from '../components/DeGitPuller'
import path from 'path'
import {ProjectType} from '../enums/ProjectType'
import {ProjectCompleteInformationOptions} from '../options/ProjectCompleteInformationOptions'
import {Spinner} from '../components/Spinner'
import {readdir} from 'fs/promises'
import {ProjectInformationUpdater} from '../objects/ProjectInformationUpdater'
import {execa} from 'execa'
import chalk from 'chalk'
import {OnlineLatestVersion} from '../objects/OnlineLatestVersion'

export class Init extends Model {

    @Inject('spinner')
    protected readonly spinner: Spinner

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Inject('onlineVersion')
    protected readonly onlineVersion: OnlineLatestVersion

    @Configurable({accept: ProjectCompleteInformationOptions, acceptOptions: {stripUnknown: true}})
    protected readonly options: ProjectCompleteInformationOptions

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

    /**
     * 执行初始化项目
     */
    public async exec(): Promise<void> {
        const files: string[] = await readdir(this.initWorkingDirectory)
        if (files.filter((file: string) => !file.startsWith('.')).length) throw new Error('The target folder is not empty. Please clear the contents of the folder before proceeding with the initialization process.')
        this.spinner.start('Initializing the project')
        await this.puller.pull(this.branch, this.initWorkingDirectory)
        const updater: ProjectInformationUpdater = await this.module.get<ProjectInformationUpdater>('updater', {workingDirectory: this.initWorkingDirectory})
        await updater.updateProjectInfo(this.options)
        await execa('npm', ['install'], {cwd: this.initWorkingDirectory})
        await execa('npm', ['install', `${this.onlineVersion.getName()}@${await this.onlineVersion.getVersion()}`], {cwd: this.initWorkingDirectory})
        this.spinner.stop()
        console.info(chalk.green('The project has been successfully initialized.'))
    }
}
