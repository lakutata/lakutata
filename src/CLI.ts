#!/usr/bin/env node

import {Command, Option} from 'commander'
import {readFile} from 'fs/promises'
import path from 'path'
import {ProjectType} from './cli/enums/ProjectType'
import {Application, Logger} from './Lakutata'
import {CommandLineController} from './cli/controllers/CommandLineController'
import {Info} from './cli/models/Info'
import {Create} from './cli/models/Create'
import {Upgrade} from './cli/models/Upgrade'
import {As} from './Helper'
import {PackageLevel} from './cli/components/PackageLevel'
import {Init} from './cli/models/Init'
import {Spinner} from './cli/components/Spinner'
import {dots} from 'cli-spinners'
import {DeGitPuller} from './cli/components/DeGitPuller'
import {ProjectInformationCompleter} from './cli/components/ProjectInformationCompleter'
import {ProjectInputInformationOptions} from './cli/options/ProjectInputInformationOptions'

type CLIParams = {
    type: string
    options: Record<string, any>
}

const asciiLogo: string = '' +
    ' _                               _             _            \n' +
    '| |               _             | |           | |           \n' +
    '| |        __ _  | | _   _   _  | |_    __ _  | |_    __ _  \n' +
    '| |       / _` | | |/ / | | | | | __|  / _` | | __|  / _` | \n' +
    '| |____  | (_| | |   <  | |_| | \\ |_  | (_| | \\ |_  | (_| | \n' +
    '|______|  \\__,_| |_|\\_\\  \\__,_|  \\__|  \\__,_|  \\__|  \\__,_| \n' +
    '                                                            '

async function getCliParams(cli: Command): Promise<CLIParams> {
    return new Promise((resolve, reject): void => {
        const init: Command = new Command('init')
            .description('initialize a Lakutata project in an existing folder')
            .addOption(new Option('-p, --path <path>', 'project init path').default(process.cwd()))
            .addOption(new Option('-t, --type <type>', 'project type').choices(Object.values(ProjectType)))
            .addOption(new Option('-n, --name <name>', 'the name of the project and application'))
            .addOption(new Option('-i, --id <id>', 'the ID of the application'))
            .addOption(new Option('-d, --description <description>', 'the description of the application'))
            .addOption(new Option('-a, --author <author>', 'the author of the application'))
            .addOption(new Option('-l, --license <license>', 'the license of the application'))
            .action((options: ProjectInputInformationOptions) => resolve({
                type: 'init',
                options: options
            }))
        const create: Command = new Command('create')
            .description('create a Lakutata project')
            .addOption(new Option('-p, --path <path>', 'project creation path').default(process.cwd()))
            .addOption(new Option('-t, --type <type>', 'project type').choices(Object.values(ProjectType)))
            .addOption(new Option('-n, --name <name>', 'the name of the project and application'))
            .addOption(new Option('-i, --id <id>', 'the ID of the application'))
            .addOption(new Option('-d, --description <description>', 'the description of the application'))
            .addOption(new Option('-a, --author <author>', 'the author of the application'))
            .addOption(new Option('-l, --license <license>', 'the license of the application'))
            .action((options: ProjectInputInformationOptions) => resolve({
                type: 'create',
                options: options
            }))
        const upgrade: Command = new Command('upgrade')
            .description('upgrade Lakutata framework')
            .action((options) => resolve({
                type: 'upgrade',
                options: options
            }))
        const info: Command = new Command('info')
            .description('show Lakutata framework info')
            .action((options) => resolve({
                type: 'info',
                options: options
            }))
        cli
            .addCommand(init)
            .addCommand(create)
            .addCommand(upgrade)
            .addCommand(info)
            .parse()
            .on('error', reject)
    })
}

(async (): Promise<void> => {
    const packageJson = JSON.parse(await readFile(path.resolve(__dirname, '../package.json'), {encoding: 'utf-8'}))
    const params: CLIParams = await getCliParams(new Command().description('Lakutata CLI').version(packageJson.version, '-v, --version').helpOption('-h, --help'))
    try {
        await Application.run({
            id: 'cli.lakutata.app',
            name: 'Lakutata CLI',
            components: {
                spinner: {
                    class: Spinner,
                    style: dots
                },
                packageLevel: {
                    class: PackageLevel,
                    name: packageJson.name,
                    currentDirectory: __dirname,
                    workingDirectory: process.cwd()
                },
                puller: {
                    class: DeGitPuller,
                    cache: false,
                    verbose: true,
                    force: true,
                    repo: 'lakutata/lakutata-template'
                },
                completer: ProjectInformationCompleter
            },
            controllers: [CommandLineController],
            autoload: [Init, Create, Upgrade, Info],
            bootstrap: [
                async (app: Application): Promise<void> => {
                    await app.dispatchToController(params, {
                        context: {
                            asciiLogo: asciiLogo,
                            name: packageJson.name,
                            version: packageJson.version,
                            description: packageJson.description,
                            license: packageJson.license
                        }
                    })
                },
                async (app: Application): Promise<void> => app.exit()
            ]
        })
    } catch (e) {
        Logger.error(As<Error>(e).message)
        process.exit(1)
    }
})()
