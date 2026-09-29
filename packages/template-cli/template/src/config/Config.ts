import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
import manifest from '../../package.json' with {type: 'json'}
import {ExampleController} from '../controllers/ExampleController.js'

/**
 * The options of the tool
 */
export function Config(): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        components: {
            entrypoint: BuildEntrypoints({
                controllers: [ExampleController],
                //The actions of the controllers are the commands; the missing required options are asked in a terminal
                cli: CommanderCLIEntrypoint({bin: '{$APP_ID}', description: manifest.description, version: manifest.version})
            })
        },
        bootstrap: ['entrypoint']
    }
}
