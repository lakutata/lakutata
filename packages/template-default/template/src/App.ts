import {Application} from 'lakutata'
import type {ILogger} from 'lakutata'
import {Config} from './config/Config.js'

Application
    .run(Config)
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
