import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {CommandLineController} from './controllers/CommandLineController.js'
import {ToolPackage} from './lib/Versions.js'

/**
 * The application of the tool
 */
export function Config(): ApplicationOptions {
    const tool = ToolPackage()
    return {
        id: 'cli.lakutata.app',
        name: 'lakutata-cli',
        components: {
            entrypoint: BuildEntrypoints({
                controllers: [CommandLineController],
                cli: CommanderCLIEntrypoint({bin: 'lakutata', description: tool.description, version: tool.version})
            })
        },
        bootstrap: ['entrypoint']
    }
}
