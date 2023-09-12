import {Component, Configurable} from '../../Lakutata'
import {dirname} from 'path'

export class PackageLevel extends Component {

    /**
     * 当前文件夹，从CLI入口传入
     * @protected
     */
    @Configurable()
    protected readonly currentDirectory: string

    /**
     * 安装文件夹，CLI入口传入的文件夹路径的父路径
     * @protected
     */
    protected installPath: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.installPath = dirname(this.currentDirectory)
    }

    /**
     * 获取安装目录
     */
    public getInstallPath(): string {
        return this.installPath
    }
}
