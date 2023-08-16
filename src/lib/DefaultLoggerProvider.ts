import {ILogger} from '../interfaces/ILogger.js'
import {createLogger} from 'bunyan'

export function DefaultLoggerProvider(): ILogger {
    const appName: string = process.env.appName ? process.env.appName : 'Unnamed'
    return createLogger({
        name: appName,
        level: 'trace'
    })
}
