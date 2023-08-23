import '../Lakutata'
import {IConstructor} from '../interfaces/IConstructor'
import {Process} from './base/Process'
import v8 from 'v8'
import {Application} from './Application'
import {Logger} from './components/Logger'
import {ILogger} from '../interfaces/ILogger'

const reversed: string[] = process.argv.reverse()
const loggerEvent: string = reversed[1]
const workerId: string = reversed[2]
const base64Configs: string = reversed[3]
const className: string = reversed[4]
const moduleFilename: string = reversed[5]
const configurableProperties: Record<string, any> = v8.deserialize(Buffer.from(base64Configs, 'base64'))
const ProcessClassConstructor: IConstructor<Process> = require(moduleFilename)[className]
process.on('uncaughtException', error => process.send!(['__$psError', error]))
const subProcessLoggerProviderProxy: ILogger = new Proxy(<ILogger>{}, {
    get: (target: ILogger, p: string, receiver: any): any => {
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
