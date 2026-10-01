import {Application, type ILogger} from 'lakutata'
import electron from 'electron'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Config} from './config/Config.js'

/**
 * The directory of the main process (build/ in development, the packaged application): the preload script and the
 * built renderer are next to it
 */
const directory: string = path.dirname(fileURLToPath(import.meta.url))

/**
 * The URL of the renderer in development (--renderer=<url>, the dev server of Vite)
 */
const renderer: string | undefined = process.argv.find((argument: string): boolean => argument.startsWith('--renderer='))?.slice('--renderer='.length)

//One instance of the application: a second one gives its window back to the first one
if (!electron.app.requestSingleInstanceLock()) {
    electron.app.exit(0)
} else {
    Application
        .run(Config({directory: directory, renderer: renderer, mode: electron.app.isPackaged ? 'production' : 'development'}))
        .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
        .onFatalException((error: Error, log: ILogger): void => {
            log.error('The application cannot start: %s', error.message)
            electron.app.exit(1)
        })
}
