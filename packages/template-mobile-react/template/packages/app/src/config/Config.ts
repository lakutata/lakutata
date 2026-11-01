import type {Duplex} from 'node:stream'
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {reactNativeServiceEntrypoint} from 'lakutata/adapter/react-native'
import {ExampleController} from '../controllers/ExampleController.js'
//@if i18n
import {buildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import {LanguageController} from '../controllers/LanguageController.js'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

export type ConfigOptions = {
    mode?: 'development' | 'production'
    /**
     * The host serving the actions to the user interface: 'native', the native module of the mobile application (the
     * socket of LAKUTATA_NODE_FD), or a socket standing for it (the tests); none on the computer of the development
     */
    host?: 'native' | Duplex
    /**
     * The port of an HTTP entrypoint for development, none by default. The tools (Postman, curl) invoke the actions with
     * POST / and the message (the pattern and the input), and receive the events pushed to them with GET /events
     * (Server-Sent Events), giving their client id in the id header (or the id query parameter)
     */
    devPort?: number
}

/**
 * The options of the application
 * @param options
 */
export function config(options: ConfigOptions = {}): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        mode: options.mode ?? 'development',
        components: {
            //@if i18n
            //The messages of the languages (src/locales), bundled with the code; created by the first request
            i18n: buildI18nOptions({messages: {'en': en, 'zh-CN': zhCN}}),
            //@end
            entrypoint: buildEntrypoints({
                //@if i18n
                controllers: [ExampleController, LanguageController],
                //The messages in the language of the environment (LANGUAGE, LANG), which the user interface gives
                middlewares: [I18nMiddleware],
                //@else
                controllers: [ExampleController],
                //@end
                //The user interface invokes the actions through the native module: ipc.invoke({cmd: 'greet', name: 'you'})
                service: [
                    ...options.host === undefined ? [] : [reactNativeServiceEntrypoint(options.host === 'native' ? {} : {socket: options.host})],
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            })
        },
        bootstrap: ['entrypoint']
    }
}
