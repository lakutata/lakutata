import {Application, type ILogger} from 'lakutata'
import {config} from './config/Config.js'

Application
    .run(config)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The service cannot start: %s', error.message))
