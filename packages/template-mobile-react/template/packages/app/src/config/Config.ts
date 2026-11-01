import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {type CapacitorBridge, capacitorServiceEntrypoint} from 'lakutata/adapter/capacitor'
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
     * The bridge of @capawesome/capacitor-nodejs serving the actions to the user interface: 'plugin', the one the plugin
     * gives the Node.js of the mobile application, or a stand-in (the tests); none on the computer of the development
     */
    bridge?: 'plugin' | CapacitorBridge
    /**
     * The port of an HTTP entrypoint for development, none by default. The user interface in a browser (npm run dev)
     * and the tools (Postman, curl) invoke the actions with POST / and the message (the pattern and the input), and
     * receive the events pushed to them with GET /events (Server-Sent Events), giving their client id in the id header
     * (or the id query parameter)
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
        //The process of the Node.js of the mobile application is the whole application: the application leaves it running
        exitProcess: options.bridge === undefined,
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
                //The user interface invokes the actions through the bridge of the plugin: window.ipc.invoke({cmd: 'greet', name: 'you'})
                service: [
                    ...options.bridge === undefined ? [] : [capacitorServiceEntrypoint(options.bridge === 'plugin' ? {} : {bridge: options.bridge})],
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            })
        },
        bootstrap: ['entrypoint']
    }
}
