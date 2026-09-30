import type {ApplicationOptions} from 'lakutata'
import {BuildEntrypoints} from 'lakutata/com/entrypoint'
import {ElectronIPCServiceEntrypoint, type IPCMain} from 'lakutata/adapter/electron'
import {MainWindow} from '../components/MainWindow.js'
import {ExampleController} from '../controllers/ExampleController.js'

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
            entrypoint: BuildEntrypoints({
                controllers: [ExampleController],
                //The renderer invokes the actions over IPC: window.lakutata.invoke({cmd: 'greet', name: 'you'})
                service: ElectronIPCServiceEntrypoint({ipcMain: options.ipcMain})
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
