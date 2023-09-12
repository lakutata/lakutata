import {Action, ActionPattern, Controller} from '../Lakutata'
import {Info} from './models/Info'
import {Upgrade} from './models/Upgrade'
import {ProjectCreator} from './models/ProjectCreator'

export class CommandLineController extends Controller {

    @Action({type: 'create'})
    public async create(inp: ActionPattern) {
        const creator: ProjectCreator = await this.app.get(ProjectCreator, {options: inp.options})
        console.log('create!!!')//todo
    }

    @Action({type: 'upgrade'})
    public async upgrade(inp: ActionPattern) {
        const upgrade: Upgrade = await this.app.get(Upgrade)
        console.log('upgrade!!!')//todo
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
