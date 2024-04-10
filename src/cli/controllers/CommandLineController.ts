import {Controller} from '../../lib/core/Controller.js'
import {CreateProjectOptions} from '../options/CreateProjectOptions.js'
import {CLIAction} from '../../decorators/ctrl/CLIAction.js'
import {type ActionPattern} from '../../types/ActionPattern.js'
import {LakutataInfoOptions} from '../options/LakutataInfoOptions.js'
import {Information} from '../lib/providers/Information.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Creator} from '../lib/providers/Creator.js'

export class CommandLineController extends Controller {

    @Inject('creator')
    protected readonly projectCreator: Creator

    @Inject('info')
    protected readonly frameworkInfo: Information

    /**
     * Create project
     * @param inp
     */
    @CLIAction('create', CreateProjectOptions.description('create a Lakutata project'))
    public async create(inp: ActionPattern<CreateProjectOptions>): Promise<void> {
        await this.projectCreator.create(inp)
    }

    /**
     * Show framework info
     * @param inp
     */
    @CLIAction('info', LakutataInfoOptions.description('show Lakutata framework info'))
    public async info(inp: ActionPattern<LakutataInfoOptions>): Promise<void> {
        await this.frameworkInfo.print()
    }
}
