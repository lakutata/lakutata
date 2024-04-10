import {Provider} from '../../../lib/core/Provider.js'
import {Inject} from '../../../decorators/di/Inject.js'
import {Information} from './Information.js'
import {DeGitPuller} from '../components/DeGitPuller.js'
import {Spinner} from '../components/Spinner.js'
import {CreateProjectOptions} from '../../options/CreateProjectOptions.js'
import {Accept} from '../../../decorators/dto/Accept.js'
import {ProjectTypeConfig} from '../ProjectTypeConfig.js'
import path from 'node:path'
import CLITable from 'cli-table3'
import ansis from 'ansis'

export class Creator extends Provider {

    @Inject('spinner')
    protected readonly spinner: Spinner

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Inject('info')
    protected readonly frameworkInfo: Information

    /**
     * Exec create
     * @param options
     */
    @Accept(CreateProjectOptions.required())
    public async create(options: CreateProjectOptions): Promise<void> {
        const appName: string = options.name
        const appId: string = options.id
        const appDescription: string = options.description
        const packageName: string = appId
        const authorName: string = options.author
        const licenseName: string = options.license
        const appType: string = options.type
        const targetPath: string = options.initOnly ? path.resolve(options.path) : path.resolve(options.path, options.name)
        const {branch} = ProjectTypeConfig[appType]
        const table: CLITable.Table = new CLITable()
        table.push(
            [{content: ansis.bold.cyan('Project Creation Information'), colSpan: 2, hAlign: 'center'}],
            [ansis.blue('APP ID & Project Name'), appId],
            [ansis.blue('APP Name'), appName],
            [ansis.blue('APP Description'), appDescription],
            [ansis.blue('Project Create Target Path'), targetPath],
            [ansis.blue('Project Create Mode'), options.initOnly ? ansis.yellow('Initialize project in an existing directory') : ansis.green('Create a new folder for the project')],
            [ansis.blue('Project Author Name'), authorName],
            [ansis.blue('Project License'), licenseName],
            [ansis.blue('Project Template Branch'), this.puller.getGitSource(branch)]
        )
        console.log(table.toString())
    }
}
