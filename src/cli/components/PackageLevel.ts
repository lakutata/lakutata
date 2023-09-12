import {Component, Configurable} from '../../Lakutata'
import path, {dirname} from 'path'
import findRoot from 'find-root'
import {DevNull} from '../../Helper'
import {readFile} from 'fs/promises'

export class PackageLevel extends Component {

    /**
     * 包名
     * @protected
     */
    @Configurable()
    protected readonly name: string

    /**
     * 当前文件夹，从CLI入口传入
     * @protected
     */
    @Configurable()
    protected readonly currentDirectory: string

    /**
     * CLI的当前工作目录
     * @protected
     */
    @Configurable()
    protected readonly workingDirectory: string

    /**
     * 安装文件夹，CLI入口传入的文件夹路径的父路径
     * @protected
     */
    protected installPath: string

    /**
     * 当前操作的工作目录的项目根目录
     * @protected
     */
    protected projectRoot: string | null

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.installPath = dirname(this.currentDirectory)
        const projectRoot: string | null = this.findProjectRoot(this.workingDirectory)
        if (projectRoot) {
            const packageJsonPath: string = path.resolve(projectRoot, './package.json')
            try {
                const packageJson = JSON.parse(await readFile(packageJsonPath, {encoding: 'utf-8'}))
                const dependenciesKeyRegExp: RegExp = new RegExp('dependencies'.toUpperCase())
                Object.keys(packageJson).forEach((key: string): void => {
                    if (dependenciesKeyRegExp.test(key.toUpperCase())) {
                        Object.keys(packageJson[key]).forEach((dependencyName: string) => {
                            if (dependencyName === this.name) {
                                this.projectRoot = projectRoot
                            }
                        })
                    }
                })
            } catch (e) {
                DevNull(e)
            }
        }
    }

    /**
     * 找到执行工作目录所在项目的项目根路径
     * @param path
     * @protected
     */
    protected findProjectRoot(path: string): string | null {
        let localRootPath: string | null = null
        while (true) {
            const _localRootPath: string | null = this.findLocalRoot(localRootPath ? dirname(localRootPath) : path)
            if (!_localRootPath)
                break
            else
                localRootPath = _localRootPath
        }
        return localRootPath
    }

    /**
     * 查找局部包含package.json的根路径
     * @param path
     * @protected
     */
    protected findLocalRoot(path: string): string | null {
        try {
            return findRoot(path)
        } catch (e) {
            return null
        }
    }

    /**
     * 获取当前指令下包的等级
     */
    public getLevel(): 'PROJECT' | 'GLOBAL' {
        return this.projectRoot ? 'PROJECT' : 'GLOBAL'
    }

    /**
     * 获取项目根路径
     */
    public getRoot(): string | null {
        return this.projectRoot
    }

    /**
     * 获取安装目录
     */
    public getInstallPath(): string {
        return this.installPath
    }

    /**
     * 获取项目级的安装版本
     */
    public async getInstalledPackageVersion(): Promise<string | null> {
        const projectRoot: string | null = this.getRoot()
        if (projectRoot) {
            try {
                const version: string = JSON.parse(await readFile(path.resolve(projectRoot, './node_modules', `./${this.name}/package.json`), {encoding: 'utf-8'})).version
                return version ? version : null
            } catch (e) {
                return null
            }
        }
        return null
    }
}
