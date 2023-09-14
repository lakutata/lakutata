import {Action, ActionPattern, Controller} from '../../Lakutata'
import {Info} from '../models/Info'
import {Upgrade} from '../models/Upgrade'
import {Create} from '../models/Create'
import {Init} from '../models/Init'

export class CommandLineController extends Controller {

    @Action({type: 'init'})
    public async initProject(inp: ActionPattern) {
        const init: Init = await this.app.get(Init, {options: inp.options})
        console.log('init!!!')//todo
    }

    @Action({type: 'create'})
    public async createProject(inp: ActionPattern) {
        console.log(inp.options)
        const creator: Create = await this.app.get(Create, {options: inp.options})
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
