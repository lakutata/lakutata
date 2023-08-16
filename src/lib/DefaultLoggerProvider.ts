import {ILogger} from '../interfaces/ILogger.js'
import {pino} from 'pino'
import pretty from 'pino-pretty'

export function DefaultLoggerProvider(level: string = 'trace'): ILogger {
    const appName: string = process.env.appName ? process.env.appName : 'Unnamed'

    return pino({level: level, name: appName}, pretty.PinoPretty())
}
