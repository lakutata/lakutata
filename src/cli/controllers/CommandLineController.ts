import {Action, ActionPattern, Controller, Inject} from '../../Lakutata'
import {Info} from '../models/Info'
import {Upgrade} from '../models/Upgrade'
import {ProjectCreator} from '../models/ProjectCreator'

export class CommandLineController extends Controller {

    @Action({type: 'create'})
    public async create(inp: ActionPattern) {
        const creator: ProjectCreator = await this.app.get(ProjectCreator, {options: inp.options})
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
