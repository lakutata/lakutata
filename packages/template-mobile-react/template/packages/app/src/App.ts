import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

/**
 * The application runs in the Node.js of the mobile application, which its native module starts and gives a socket
 * (LAKUTATA_NODE_FD), or on the computer of the development (npm run dev: the tools reach it over HTTP)
 */
const mobile: boolean = process.env.LAKUTATA_NODE_FD !== undefined

Application
    .run(config(mobile ? {mode: 'production', host: 'native'} : {mode: 'development', devPort: Number(process.env.DEV_PORT ?? 9000)}))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
