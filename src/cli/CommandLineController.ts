import {Action, ActionPattern, Controller} from '../Lakutata'
import {InfoModel} from './models/InfoModel'
import {UpgradeModel} from './models/UpgradeModel'
import {ProjectCreatorModel} from './models/ProjectCreatorModel'

export class CommandLineController extends Controller {

    @Action({type: 'create'})
    public async create(inp: ActionPattern) {
        const creator: ProjectCreatorModel = await this.app.get(ProjectCreatorModel)
        console.log('create!!!')//todo
    }

    @Action({type: 'upgrade'})
    public async upgrade(inp: ActionPattern) {
        const upgrade: UpgradeModel = await this.app.get(UpgradeModel)
        console.log('upgrade!!!')//todo
    }

    @Action({type: 'info'})
    public async info(inp: ActionPattern) {
        const info: InfoModel = await this.app.get(InfoModel)
        console.log('info!!!')//todo
    }
}
