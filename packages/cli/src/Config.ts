import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {CommandLineController} from './controllers/CommandLineController.js'
import {WorkspaceController} from './controllers/WorkspaceController.js'
import {PackController} from './controllers/PackController.js'
import {MigrationController} from './controllers/MigrationController.js'
import {NativeController} from './controllers/NativeController.js'
import {I18nController} from './controllers/I18nController.js'
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
                controllers: [CommandLineController, WorkspaceController, PackController, MigrationController, NativeController, I18nController],
                cli: CommanderCLIEntrypoint({bin: 'lakutata', description: tool.description, version: tool.version})
            })
        },
        bootstrap: ['entrypoint']
    }
}
