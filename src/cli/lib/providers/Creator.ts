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
import {Logger} from '../../../components/Logger.js'
import {mkdir, readdir, stat} from 'node:fs/promises'
import {Stats} from 'node:fs'
import {Application} from '../../../lib/core/Application.js'
import {IsExists} from '../../../lib/helpers/IsExists.js'
import {charCheck, charCross} from '../SpecialChar.js'

export class Creator extends Provider {

    @Inject(Application)
    protected readonly app: Application

    @Inject('log')
    protected readonly log: Logger

    @Inject('spinner')
    protected readonly spinner: Spinner

    @Inject('puller')
    protected readonly puller: DeGitPuller

    @Inject('info')
    protected readonly frameworkInfo: Information

    /**
     * Check if the target path exists
     * @param targetDirectory
     * @param initOnly
     * @protected
     */
    protected async checkTargetPathExistence(targetDirectory: string, initOnly: boolean): Promise<void> {
        const exists: boolean = await IsExists(targetDirectory)
        if (!exists && initOnly) {
            this.log.error(`${charCross} The target path does not exist.`)
            return this.app.exit(1)
        }
        await mkdir(targetDirectory, {recursive: true})
        this.log.info(`${charCheck} The target path does not exist.`)
    }

    /**
     * Check target path is a valid directory
     * @param targetDirectory
     * @protected
     */
    protected async checkTargetPathIsDirectory(targetDirectory: string): Promise<void> {
        const targetInfo: Stats = await stat(targetDirectory)
        if (!targetInfo.isDirectory()) {
            this.log.error(`${charCross} The target path is not a valid directory.`)
            return this.app.exit(1)
        }
        this.log.info(`${charCheck} The target path is a valid directory.`)
    }

    /**
     * Check target directory is empty, if the target directory is not empty, throw error and exit
     * @param targetDirectory
     * @protected
     */
    protected async checkTargetDirectoryIsEmpty(targetDirectory: string): Promise<void> {
        const files: string[] = await readdir(targetDirectory)
        if (files.length) {
            this.log.error(`${charCross} The target directory is not empty.`)
            return this.app.exit(1)
        }
        this.log.info(`${charCheck} The target directory is empty.`)
    }

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
        await new Promise<void>(resolve => {
            let timeLeft: number = 15
            const interval: NodeJS.Timeout = setInterval((): void => {
                timeLeft -= 1
                if (!timeLeft) {
                    clearInterval(interval)
                    this.spinner.stop()
                    return resolve()
                }
            }, 1000)
            this.spinner.start((): string => `Please confirm the project creation information; the creation process will commence in ${timeLeft} seconds.`)
        })
        await this.checkTargetPathExistence(targetPath, options.initOnly)
        await this.checkTargetPathIsDirectory(targetPath)
        await this.checkTargetDirectoryIsEmpty(targetPath)
        this.log.info('Begin project creation')
        //TODO
    }
}
