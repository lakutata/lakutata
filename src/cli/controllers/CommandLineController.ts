import {Controller} from '../../lib/core/Controller.js'
import {CreateProjectOptions} from '../options/CreateProjectOptions.js'
import {CLIAction} from '../../decorators/ctrl/CLIAction.js'
import {type ActionPattern} from '../../types/ActionPattern.js'

export class CommandLineController extends Controller {

    /**
     * Create project
     * @param inp
     */
    @CLIAction('create', CreateProjectOptions.description('create a Lakutata project'))
    public async create(inp: ActionPattern<CreateProjectOptions>): Promise<void> {
        console.log('This is a test', inp)
    }
}
