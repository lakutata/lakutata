import {Application, resourcesPath, type ILogger} from 'lakutata'
import electron from 'electron'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {config} from './config/Config.js'

/**
 * The directory of the preload script and of the built renderer: the resources of the packaged application
 * (lakutata.resources), the directory of the main process in development (build/, the renderer of the ui package)
 */
const directory: string = resourcesPath() ?? path.dirname(fileURLToPath(import.meta.url))

/**
 * The URL of the renderer in development (--renderer=<url>, the dev server of Vite)
 */
const renderer: string | undefined = process.argv.find((argument: string): boolean => argument.startsWith('--renderer='))?.slice('--renderer='.length)

//One instance of the application: a second one gives its window back to the first one
if (!electron.app.requestSingleInstanceLock()) {
    electron.app.exit(0)
} else {
    Application
        .run(config({
            directory: directory,
            renderer: renderer,
            mode: electron.app.isPackaged ? 'production' : 'development',
            //The actions served to the tools in development (Postman, curl), not by the packaged application
            devPort: electron.app.isPackaged ? undefined : Number(process.env.DEV_PORT ?? 9000)
        }))
        .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
        .onFatalException((error: Error, log: ILogger): void => {
            log.error('The application cannot start: %s', error.message)
            electron.app.exit(1)
        })
}
