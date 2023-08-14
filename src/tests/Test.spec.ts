import 'reflect-metadata'
import {Application, BaseObject, DTO} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'
import {Accept, Expect, IndexSignature} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'
import {RandomString} from '../Utilities.js'
import {TestModel} from './models/TestModel.js'
import {Formatter} from '../lib/components/Formatter.js'
import {Test1Controller} from './controllers/Test1Controller.js'
import {Time} from '../Time.js'
import {pino} from 'pino'
import {Logger} from '../lib/components/Logger.js'

(async () => {

    console.time('app')
    const app = await Application.run({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        // timezone: 'Africa/Accra',
        // mode: 'production',
        mode: 'development',
        entries: {
            testObject: {class: TestObject, username: 'tester'},
            testInterval: {
                class: TestInterval,
                interval: 10000,
                mode: 'SEQ'
            }
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //  tester: 'this is tester'
            // }
        },
        autoload: [
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*',
            MDSTest1
        ],
        components: {
            testComponent: {class: TestComponent, greet: 'hello world'}
        },
        modules: {
            tm: {class: TestModule1, greet: 'oh!'},
            tm1: TestModule1
        },
        controllers: [
            // '/Users/alex/WebstormProjects/core/src/tests/controllers/**/*',
            Test1Controller
        ],
        bootstrap: [
            'tm',
            'tm1',
            'testInterval',
            MDSTest1,
            async (app: Application) => {
                const formatter = await app.get<Formatter>('formatter')
                console.log(formatter.asPercent(1))
                console.log('app.mode():', app.mode())
                await app.set('mmm', {class: MDSTest1, tester: 'this is tester'})
                await app.set('testModel', {class: TestModel, greet: 'hello model'})
                const subScope = app.createScope()
                const testModel = (await subScope.get<TestModel>('testModel'))
                testModel.on('property-changed', console.log)
                console.log('testModel.greet:', testModel.greet)
                testModel.aa = '6666668888888'
                await subScope.destroy()
                console.log(await app.invoke({a: 1, b: 2}, {testBoolean: true}))
                const logger = await app.get<Logger>('logger')
                logger.trace('more on this: %s', process.env.NODE_ENV)
            }
        ]
    })
    console.timeEnd('app')

    console.log(new Time('1968-01-01').add(1, 'day'))
    let time = new Time('1968-01-01')
    const time2 = new Time('1968-01-01')
    console.log(time2.timezone(), time2, time2.toISOString(), time2.toString(), time2.toTimeString(), time2.toDateString(), time2.toUTCString())
    time = time.timezone('Africa/Accra')
    console.log(time.timezone(), time, time.toISOString(), time.toString(), time.toTimeString(), time.toDateString(), time.toUTCString())


    Logger.trace('more on this: %s', process.env.NODE_ENV)
    // test.error()
    // app.exit()
})()
