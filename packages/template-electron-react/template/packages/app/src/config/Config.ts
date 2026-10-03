import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {ElectronIPCServiceEntrypoint, type IPCMain} from 'lakutata/adapter/electron'
import {SocketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
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
     * The port of the socket.io entrypoint of the development, none by default: the actions invoked and their events
     * received by the tools (Postman), the event "request" of the requests, the id of their client in the header id
     */
    socket?: number
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
                    //The event of the requests of the version 2
                    ...options.socket === undefined ? [] : [SocketIOServiceEntrypoint({port: options.socket, event: 'request'})]
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
