import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import manifest from '../../package.json' with {type: 'json'}
import {ExampleController} from '../controllers/ExampleController.js'
//@if i18n
import {buildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

/**
 * The options of the tool
 */
export function installerConfig(): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        components: {
            //@if i18n
            //The messages of the languages (src/locales), bundled with the code; created by the first request
            i18n: buildI18nOptions({messages: {'en': en, 'zh-CN': zhCN}}),
            //@end
            entrypoint: buildEntrypoints({
                controllers: [ExampleController],
                //@if i18n
                //The messages in the language of its environment (LANG)
                middlewares: [I18nMiddleware],
                //@end
                //The actions of the controllers are the commands; the missing required options are asked in a terminal
                cli: commanderCLIEntrypoint({bin: '{$APP_ID}', description: manifest.description, version: manifest.version})
            })
        },
        bootstrap: ['entrypoint']
    }
}
