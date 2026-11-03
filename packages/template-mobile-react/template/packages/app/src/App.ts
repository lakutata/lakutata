import {Application, type ILogger} from 'lakutata'
import os from 'node:os'
import path from 'node:path'
import {config} from './config/Config.js'

/**
 * The application runs in the Node.js of the mobile application, which its native module starts and gives a socket
 * (LAKUTATA_NODE_FD), or on the computer of the development (npm run dev: the tools reach it over HTTP)
 */
const mobile: boolean = process.env.LAKUTATA_NODE_FD !== undefined

/**
 * The directory of the files that have to last (a database, the settings), kept until the application is uninstalled;
 * os.tmpdir() is its cache, which the system may empty. Its alias @data names it: path.resolve('@data/app.sqlite')
 */
function dataDirectory(): string {
    switch (process.platform as string) {
        //The files of the application: the native module runs the project copied into files/nodejs (NodeProject.kt)
        case 'android':
            return path.dirname(process.env.LAKUTATA_NODE_PROJECT!)
        //Library/Application Support in the container of the application, its home
        case 'ios':
            return path.join(os.homedir(), 'Library', 'Application Support')
        //The files of the application in its sandbox
        case 'openharmony':
            return '/data/storage/el2/base/files'
        //The computer of the development
        default:
            return './data'
    }
}

Application
    //The aliases are declared before the options are read: the options are given by a function
    .alias({'@data': dataDirectory()}, true)
    .run(() => config(mobile ? {mode: 'production', host: 'native'} : {mode: 'development', devPort: Number(process.env.DEV_PORT ?? 9000)}))
    .onLaunched((app: Application, log: ILogger): void => log.info('%s started in %s mode', app.appName, app.mode()))
    .onFatalException((error: Error, log: ILogger): void => log.error('The application cannot start: %s', error.message))
