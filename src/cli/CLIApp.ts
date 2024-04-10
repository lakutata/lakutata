import {Application} from '../lib/core/Application.js'
import {
    BuildCLIEntrypoint,
    BuildEntrypoints, CLIContext,
    CLIEntrypointHandler,
    CLIMap,
    EntrypointDestroyerRegistrar
} from '../components/Entrypoint.js'
import {Module} from '../lib/core/Module.js'
import {Command} from 'commander'
import {JSONSchema} from '../types/JSONSchema.js'
import {CommandLineController} from './controllers/CommandLineController.js'
import {Logger} from '../components/Logger.js'

Application.run({
    id: 'cli.lakutata.app',
    name: 'Lakutata-CLI',
    components: {
        entrypoint: BuildEntrypoints({
            cli: BuildCLIEntrypoint((module: Module, cliMap: CLIMap, handler: CLIEntrypointHandler, registerDestroy: EntrypointDestroyerRegistrar) => {
                const CLIProgram: Command = new Command()
                cliMap.forEach((dtoJsonSchema: JSONSchema, command: string): void => {
                    const cmd: Command = new Command(command).description(dtoJsonSchema.description!)
                    for (const property in dtoJsonSchema.properties) {
                        const attr: JSONSchema = dtoJsonSchema.properties[property]
                        cmd.option(`--${property} <${attr.type}>`, attr.description)
                    }
                    cmd.action(async (args): Promise<any> => await handler(new CLIContext({
                        command: command,
                        data: args
                    })))
                    CLIProgram
                        .addCommand(cmd)
                        .parse()
                })
            })
        })
    },
    controllers: [CommandLineController],
    bootstrap: ['entrypoint']
})
    .onUncaughtException((error: Error, logger: Logger) => logger.error(error.message))
