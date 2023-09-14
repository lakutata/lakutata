import {BaseObject, Configurable, Transient} from '../../Lakutata'
import path from 'path'
import {readFile, writeFile, rm} from 'fs/promises'
import {Exists, TextTemplate} from '../../Helper'
import {ProjectCompleteInformationOptions} from '../options/ProjectCompleteInformationOptions'

/**
 * 项目信息更新器
 */
@Transient()
export class ProjectInformationUpdater extends BaseObject {

    @Configurable()
    protected readonly workingDirectory: string

    protected packageJsonFilename: string

    protected applicationConfigFilename: string

    protected readmeFilename: string

    protected packageJson: string

    protected applicationConfig: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.readmeFilename = path.resolve(this.workingDirectory, './README.md')
        this.packageJsonFilename = path.resolve(this.workingDirectory, './package.json')
        this.applicationConfigFilename = path.resolve(this.workingDirectory, './src/config/Config.ts')
        if (!(await Exists(this.packageJsonFilename))) throw new Error('The package.json file could not be found.')
        if (!(await Exists(this.applicationConfigFilename))) throw new Error('The Config.ts file could not be found.')
        this.packageJson = await readFile(this.packageJsonFilename, {encoding: 'utf-8'})
        this.applicationConfig = await readFile(this.applicationConfigFilename, {encoding: 'utf-8'})
        //删除README.md
        if (await Exists(this.readmeFilename)) await rm(this.readmeFilename, {recursive: true, force: true})
    }

    /**
     * 设置应用程序ID
     * @param id
     * @protected
     */
    protected setId(id: string): void {
        this.applicationConfig = TextTemplate(this.applicationConfig, {id: id}, {ignoreMissing: true})
    }

    /**
     * 设置项目名称
     * @param name
     * @protected
     */
    protected setName(name: string): void {
        this.packageJson = TextTemplate(this.packageJson, {name: name}, {ignoreMissing: true})
        this.applicationConfig = TextTemplate(this.applicationConfig, {name: name}, {ignoreMissing: true})
    }

    /**
     * 设置项目说明
     * @param description
     * @protected
     */
    protected setDescription(description: string): void {
        this.packageJson = TextTemplate(this.packageJson, {description: description}, {ignoreMissing: true})
    }

    /**
     * 设置作者名称
     * @param author
     * @protected
     */
    protected setAuthor(author: string): void {
        this.packageJson = TextTemplate(this.packageJson, {author: author}, {ignoreMissing: true})
    }

    /**
     * 设置许可证名字
     * @param license
     * @protected
     */
    protected setLicense(license: string): void {
        this.packageJson = TextTemplate(this.packageJson, {license: license.toUpperCase()}, {ignoreMissing: true})
    }

    /**
     * 将项目信息进行保存
     * @protected
     */
    protected async save(): Promise<void> {
        await writeFile(this.packageJsonFilename, this.packageJson, {flag: 'w+'})
        await writeFile(this.applicationConfigFilename, this.applicationConfig, {flag: 'w+'})
    }

    /**
     * 执行更新项目信息
     * @param options
     */
    public async updateProjectInfo(options: ProjectCompleteInformationOptions): Promise<void> {
        this.setId(options.id)
        this.setName(options.name)
        this.setDescription(options.description)
        this.setAuthor(options.author)
        this.setLicense(options.license)
        await this.save()
    }
}
