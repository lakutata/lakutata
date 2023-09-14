import {Action, ActionPattern, Controller, Inject} from '../../Lakutata'
import {Info} from '../models/Info'
import {Upgrade} from '../models/Upgrade'
import {Create} from '../models/Create'
import {Init} from '../models/Init'
import {ProjectInformationCompleter} from '../components/ProjectInformationCompleter'

export class CommandLineController extends Controller {

    @Inject('completer')
    protected readonly completer: ProjectInformationCompleter

    /**
     * 在指定目录中初始化Lakutata项目(已有文件夹)
     * @param inp
     */
    @Action({type: 'init'})
    public async initProject(inp: ActionPattern): Promise<void> {
        const init: Init = await this.app.get(Init, {options: await this.completer.complete(inp.options)})
        //todo 调起inquery，输入其他项目信息

    }

    /**
     * 在指定目录创建一个Lakutata项目(新文件夹)
     * @param inp
     */
    @Action({type: 'create'})
    public async createProject(inp: ActionPattern): Promise<void> {
        const creator: Create = await this.app.get(Create, {options: await this.completer.complete(inp.options)})
        await creator.exec()
        console.log('create!!!')//todo
    }

    /**
     * 检查升级，若有升级则执行升级
     * @param inp
     */
    @Action({type: 'upgrade'})
    public async upgrade(inp: ActionPattern): Promise<void> {
        const upgrade: Upgrade = await this.app.get(Upgrade, this.context)
        upgrade.echoCurrentVersion()
        const newVersion: string | void = await upgrade.checkUpdate()
        if (!newVersion) return upgrade.echoNoUpdateAvailable()
        await upgrade.upgradeInstall(newVersion)
    }

    /**
     * 输出项目信息
     * @param inp
     */
    @Action({type: 'info'})
    public async info(inp: ActionPattern): Promise<void> {
        const info: Info = await this.app.get(Info, this.context)
        info.lines.forEach((line: String) => console.info(line))
    }
}
