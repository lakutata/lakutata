import {Controller} from '../../lib/core/Controller.js'
import {CreateProjectOptions} from '../options/CreateProjectOptions.js'
import {CLIAction} from '../../decorators/ctrl/CLIAction.js'
import {type ActionPattern} from '../../types/ActionPattern.js'
import {LakutataInfoOptions} from '../options/LakutataInfoOptions.js'
import {Information} from '../lib/providers/Information.js'
import {Inject} from '../../decorators/di/Inject.js'

export class CommandLineController extends Controller {

    @Inject('info')
    protected readonly frameworkInfo: Information

    /**
     * Create project
     * @param inp
     */
    @CLIAction('create', CreateProjectOptions.description('create a Lakutata project'))
    public async create(inp: ActionPattern<CreateProjectOptions>): Promise<void> {
        console.log('This is a test', inp)//TODO
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
