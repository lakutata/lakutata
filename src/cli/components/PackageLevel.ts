import {Component, Configurable, Scoped} from '../../Lakutata'

@Scoped()
export class PackageLevel extends Component {

    @Configurable()
    protected readonly currentDirectory: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        console.log(this.currentDirectory)
    }

    /**
     * 获取安装目录
     */
    public getInstallPath(): string {
        return this.currentDirectory
    }
}
