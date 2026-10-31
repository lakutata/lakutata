import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

/**
 * The URL of the user interface in development (--ui=<url>, the dev server of Vite), given to lakutata nwjs run
 */
const ui: string | undefined = nw.App.argv.find((argument: string): boolean => argument.startsWith('--ui='))?.slice('--ui='.length)

/**
 * The application runs in the NW.js of the development (lakutata nwjs run: the sdk flavor, with the DevTools), in the
 * normal one once installed
 */
const development: boolean = process.versions['nw-flavor'] === 'sdk'

//NW.js runs a single instance of the application: a second one exits, and the first one brings its window to the front
Application
    .run(config({
        ui: ui,
        mode: development ? 'development' : 'production',
        //The actions served to the tools in development (Postman, curl), not by the installed application
        devPort: development ? Number(process.env.DEV_PORT ?? 9000) : undefined
    }))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => {
        log.error('The application cannot start: %s', error.message)
        process.exit(1)
    })
