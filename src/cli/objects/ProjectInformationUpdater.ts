import {BaseObject, Configurable, Transient} from '../../Lakutata'
import path from 'path'
import {readFile, writeFile, rm} from 'fs/promises'
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

    protected readmeFilename: string

    protected packageJson: Record<string, any>

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
        this.packageJson = JSON.parse(await readFile(this.packageJsonFilename, {encoding: 'utf-8'}))
        this.applicationConfig = await readFile(this.applicationConfigFilename, {encoding: 'utf-8'})
        //删除README.md
        if (await Exists(this.readmeFilename)) await rm(this.readmeFilename, {recursive: true, force: true})
    }

    /**
     * 设置应用程序ID
     * @param id
     */
    public setId(id: string): void {
        this.applicationConfig = TextTemplate(this.applicationConfig, {id: id}, {ignoreMissing: true})
    }

    /**
     * 设置项目名称
     * @param name
     */
    public setName(name: string): void {
        this.packageJson.name = name
        this.applicationConfig = TextTemplate(this.applicationConfig, {name: name}, {ignoreMissing: true})
    }

    /**
     * 设置项目说明
     * @param description
     */
    public setDescription(description: string): void {
        this.packageJson.description = description
    }

    /**
     * 设置作者名称
     * @param author
     */
    public setAuthor(author: string): void {
        this.packageJson.author = author
    }

    /**
     * 设置许可证名字
     * @param license
     */
    public setLicense(license: string): void {
        this.packageJson.license = license.toUpperCase()
    }

    /**
     * 将项目信息进行保存
     */
    public async save(): Promise<void> {
        await writeFile(this.packageJsonFilename, JSON.stringify(this.packageJson, null, 2), {flag: 'w+'})
        await writeFile(this.applicationConfigFilename, this.applicationConfig, {flag: 'w+'})
    }
}
