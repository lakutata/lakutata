import {ILogger} from '../interfaces/ILogger.js'
import {pino} from 'pino'
import pretty from 'pino-pretty/index.js'

export function DefaultLoggerProvider(level: string = 'trace'): ILogger {
    const appName: string = process.env.appName ? process.env.appName : 'Unnamed'
    const stream = (pretty as any)()
    return pino({level: level, name: appName}, stream)
}
