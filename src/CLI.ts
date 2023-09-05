#!/usr/bin/env node

import {Command, Option} from 'commander'
import {readFile} from 'fs/promises'
import path from 'path'
import {ProjectType} from './cli/enums/ProjectType'
import {Application, Logger} from './Lakutata'
import {CommandLineController} from './cli/CommandLineController'
import {Info} from './cli/models/Info'
import {ProjectCreator} from './cli/models/ProjectCreator'
import {Upgrade} from './cli/models/Upgrade'
import {As} from './Helper'

/**
 * generate
 * upgrade
 * version
 */

type CLIParams = {
    type: string
    options: Record<string, any>
}

async function getCliParams(cli: Command): Promise<CLIParams> {
    return new Promise((resolve, reject): void => {
        const create: Command = new Command('create')
            .description('create a Lakutata project')
            .addOption(new Option('-p, --path <path>', 'project creation path').default(process.cwd()))
            .addOption(new Option('-t, --type <type>', 'project type').choices(Object.values(ProjectType)))
            .addOption(new Option('-n, --name <name>', 'project name'))
            .action((options) => {
                //todo 处理路径等信息
                return resolve({
                    type: 'create',
                    options: options
                })
            })
        const upgrade: Command = new Command('upgrade')
            .description('upgrade Lakutata framework')
            .action((options) => {
                //todo 处理其他信息
                return resolve({
                    type: 'upgrade',
                    options: options
                })
            })
        const info: Command = new Command('info')
            .description('show Lakutata framework info')
            .action((options) => {
                //todo 处理其他信息
                return resolve({
                    type: 'info',
                    options: options
                })
            })
        cli
            .addCommand(create)
            .addCommand(upgrade)
            .addCommand(info)
            .parse()
            .on('error', reject)
    })
}

(async (): Promise<void> => {
    const {version} = JSON.parse(await readFile(path.resolve(__dirname, '../package.json'), {encoding: 'utf-8'}))
    const params: CLIParams = await getCliParams(new Command().description('Lakutata CLI').version(version, '-v, --version').helpOption('-h, --help'))
    try {
        await Application.run({
            id: 'cli.lakutata.app',
            name: 'Lakutata CLI',
            controllers: [CommandLineController],
            autoload: [ProjectCreator, Upgrade, Info],
            bootstrap: [
                async (app: Application): Promise<void> => {
                    await app.dispatchToController(params)
                }
            ]
        })
    } catch (e) {
        Logger.error(As<Error>(e).message)
        process.exit(1)
    }
})()
