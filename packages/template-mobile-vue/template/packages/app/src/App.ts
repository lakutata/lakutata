import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

/**
 * The application runs in the Node.js of the mobile application (@capawesome/capacitor-nodejs: Android, iOS), or on the
 * computer of the development (npm run dev: the user interface in a browser reaches it over HTTP)
 */
const mobile: boolean = (['android', 'ios'] as string[]).includes(process.platform)

Application
    .run(config(mobile ? {mode: 'production', bridge: 'plugin'} : {mode: 'development', devPort: Number(process.env.DEV_PORT ?? 9000)}))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
