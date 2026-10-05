import {Application, type ILogger} from 'lakutata'
import {installerConfig} from './config/Config.js'

Application
    .run(installerConfig)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
