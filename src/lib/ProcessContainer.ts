import {
    IConstructor,
    Process,
    Application,
    Logger,
    ILogger
} from '../Lakutata'
import v8 from 'v8'

const reversed: string[] = process.argv.reverse()
const loggerEvent: string = reversed[1]
const workerId: string = reversed[2]
const base64Configs: string = reversed[3]
const className: string = reversed[4]
const moduleFilename: string = reversed[5]
const configurableProperties: Record<string, any> = v8.deserialize(Buffer.from(base64Configs, 'base64'))
const ProcessClassConstructor: IConstructor<Process> = require(moduleFilename)[className]
process
    .on('uncaughtException', (error: Error) => process.send!(['__$psError', error]))
    .on('disconnect', () => process.exit())
const subProcessLoggerProviderProxy: ILogger = new Proxy(<ILogger>{}, {
    get: (t: ILogger, p: string, r: any): any => {
        return (...args: any[]): void => {
            process.send!([loggerEvent, p, ...args])
        }
    }
})
Application.run({
    id: `${className}.${workerId}`,
    name: `${className}-${process.env.appName}`,
    timezone: process.env.TZ,
    components: {
        log: {
            class: Logger,
            provider: subProcessLoggerProviderProxy
        }
    },
    entries: {
        [ProcessClassConstructor.name]: {
            class: ProcessClassConstructor,
            ...configurableProperties
        }
    },
    bootstrap: [ProcessClassConstructor.name]
})
    .then(() => process.send!(['ready']))
    .catch(e => process.send!(['__$psError', e]))
