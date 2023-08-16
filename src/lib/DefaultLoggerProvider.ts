import {ILogger} from '../interfaces/ILogger.js'
import {pino} from 'pino'
import 'pino-pretty'

export function DefaultLoggerProvider(level: string = 'trace'): ILogger {
    const appName: string = process.env.appName ? process.env.appName : 'Unnamed'
    return pino({
        name: appName,
        transport: {
            target: 'pino-pretty'
        },
        level: level
    })
}
