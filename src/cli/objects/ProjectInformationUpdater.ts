import {BaseObject, Configurable, Transient} from '../../Lakutata'
import path from 'path'
import {Exists, TextTemplate} from '../../Helper'

/**
 * 项目信息更新器
 */
@Transient()
export class ProjectInformationUpdater extends BaseObject {

    @Configurable()
    protected readonly workingDirectory: string

    protected packageJsonFilename: string

    protected applicationConfigFilename: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.packageJsonFilename = path.resolve(this.workingDirectory, './package.json')
        this.applicationConfigFilename = path.resolve(this.workingDirectory, './src/config/Config.ts')
        if (!(await Exists(this.packageJsonFilename))) throw new Error('The package.json file could not be found.')
        if (!(await Exists(this.applicationConfigFilename))) throw new Error('The Config.ts file could not be found.')
        // TextTemplate()
    }
}
