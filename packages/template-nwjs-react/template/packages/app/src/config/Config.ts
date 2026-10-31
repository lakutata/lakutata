import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
import {nwjsServiceEntrypoint} from 'lakutata/adapter/nwjs'
import {MainWindow} from '../components/MainWindow.js'
import {ExampleController} from '../controllers/ExampleController.js'
//@if i18n
import {buildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

export type ConfigOptions = {
    /**
     * The URL of the user interface in development (the dev server of Vite), its built files otherwise
     */
    ui?: string
    mode?: 'development' | 'production'
    /**
     * Open the window, true by default (the tests serve the actions without window)
     */
    window?: boolean
    /**
     * The global object the bridge of the actions is put on, the one of NW.js by default (the tests give theirs)
     */
    global?: object
    /**
     * The port of an HTTP entrypoint for development, none by default. Tools (Postman, curl) invoke the actions with
     * POST / and the message (the pattern and the input), receive the events pushed to them with GET /events
     * (Server-Sent Events), and give their client id in the id header (or the id query parameter)
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
                controllers: [ExampleController],
                //@if i18n
                //The messages in the language of its environment (LANG)
                middlewares: [I18nMiddleware],
                //@end
                //The user interface invokes the actions through the host page of the window: window.ipc.invoke({cmd: 'greet', name: 'you'})
                service: [
                    nwjsServiceEntrypoint({global: options.global}),
                    ...options.devPort === undefined ? [] : [httpServiceEntrypoint({port: options.devPort})]
                ]
            }),
            ...(options.window === false ? {} : {
                window: {
                    class: MainWindow,
                    ui: options.ui
                }
            })
        },
        //The actions are served before the window loads the user interface
        bootstrap: options.window === false ? ['entrypoint'] : ['entrypoint', 'window']
    }
}
