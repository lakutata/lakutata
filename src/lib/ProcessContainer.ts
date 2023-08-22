import '../Lakutata'
import {IConstructor} from '../interfaces/IConstructor'
import {Process} from './base/Process'
import v8 from 'v8'
import {Application} from './Application'

const reversed: string[] = process.argv.reverse()
const workerId: string = reversed[0]
const base64Configs: string = reversed[1]
const className: string = reversed[2]
const moduleFilename: string = reversed[3]
const configurableProperties: Record<string, any> = v8.deserialize(Buffer.from(base64Configs, 'base64'))
const ProcessClassConstructor: IConstructor<Process> = require(moduleFilename)[className]
Application.run({
    id: `${className}.${workerId}`,
    name: `${className}-${process.env.appName}`,
    timezone: process.env.TZ,
    entries: {
        proc: {
            class: ProcessClassConstructor,
            ...configurableProperties
        }
    },
    bootstrap: ['proc']
})
