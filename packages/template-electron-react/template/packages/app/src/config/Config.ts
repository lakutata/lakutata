import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints, HTTPServiceEntrypoint} from 'lakutata/com/entrypoint'
import {ElectronIPCServiceEntrypoint, type IPCMain} from 'lakutata/adapter/electron'
import {MainWindow} from '../components/MainWindow.js'
import {ExampleController} from '../controllers/ExampleController.js'
//@if i18n
import {BuildI18nOptions, I18nMiddleware} from 'lakutata/com/i18n'
import en from '../locales/en.json' with {type: 'json'}
import zhCN from '../locales/zh-CN.json' with {type: 'json'}
//@end

export type ConfigOptions = {
    /**
     * The directory of the main process, where the preload script and the built renderer are
     */
    directory?: string
    /**
     * The URL of the renderer in development (the dev server of Vite), the built renderer otherwise
     */
    renderer?: string
    mode?: 'development' | 'production'
    /**
     * Open the window, true by default (the tests serve the actions without window)
     */
    window?: boolean
    /**
     * The ipcMain serving the actions, the one of Electron by default (the tests give theirs)
     */
    ipcMain?: IPCMain
    /**
     * The port of the HTTP entrypoint of the development, none by default: the actions invoked by the tools (Postman,
     * curl: POST / with their pattern and their input), the events pushed to them received (GET /events, Server-Sent
     * Events), the id of their client in the header id (or the query id of the events)
     */
    devPort?: number
}

/**
 * The options of the application
 * @param options
 */
export function Config(options: ConfigOptions = {}): ApplicationOptions {
    return {
        id: '{$APP_ID}',
        name: '{$APP_NAME}',
        mode: options.mode ?? 'development',
        components: {
            //@if i18n
            //The messages of the languages (src/locales), bundled with the code; created by the first request
            i18n: BuildI18nOptions({messages: {'en': en, 'zh-CN': zhCN}}),
            //@end
            entrypoint: BuildEntrypoints({
                controllers: [ExampleController],
                //@if i18n
                //The messages in the language of its environment (LANG)
                middlewares: [I18nMiddleware],
                //@end
                //The renderer invokes the actions over IPC: window.ipc.invoke({cmd: 'greet', name: 'you'})
                service: [
                    ElectronIPCServiceEntrypoint({ipcMain: options.ipcMain}),
                    ...options.devPort === undefined ? [] : [HTTPServiceEntrypoint({port: options.devPort})]
                ]
            }),
            ...(options.window === false ? {} : {
                window: {
                    class: MainWindow,
                    directory: options.directory,
                    renderer: options.renderer
                }
            })
        },
        //The actions are served before the window loads the renderer
        bootstrap: options.window === false ? ['entrypoint'] : ['entrypoint', 'window']
    }
}
