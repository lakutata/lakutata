import 'reflect-metadata'
import {Application, Formatter, Logger, Time} from '../Lakutata'
import {TestObject} from './objects/TestObject'
import {TestInterval} from './intervals/TestInterval'
import {MDSTest1} from './mds/MDSTest1'
import {TestComponent} from './components/TestComponent'
import {TestModule1} from './modules/TestModule1/TestModule1'
import {Test1Controller} from './controllers/Test1Controller'
import {TestModel} from './models/TestModel'
import path from 'path'
import fs from 'fs'
import {Worker} from 'worker_threads'
import {fork} from 'child_process'
import {transpileModule} from 'typescript'

(async () => {
    // fork('./src/tests/TestProc.js')
    // new Worker('./src/tests/TestProc.js')

    // fork('@test')
    // new Worker('@test')


    console.log('##################@@@@@@@@@@@@Application.className:', Application.className)

    const compiled = transpileModule(fs.readFileSync(path.resolve(__dirname, './TestProc.ts'), {encoding: 'utf-8'}), {}).outputText

    // new Worker(path.resolve(__dirname, './TestProc.ts'))

    // fork(path.resolve(__dirname, './TestProc.ts'))

    console.time('app')
    await Application.run({
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
        alias: {
            '@test': '@app/hh/jj'
        },
        bootstrap: [
            'tm',
            'tm1',
            'testInterval',
            MDSTest1,
            async (app: Application) => {
                // fork(path.resolve('@app', 'TestProc.js'))
                // new Worker(path.resolve('@app', 'TestProc.js'))

                // console.log('============transpileModule==========')
                // let tstring=ts.transpileModule(fs.readFileSync(path.resolve('@app', 'TestProc.ts'),{encoding:'utf-8'}),{
                //     compilerOptions:{module:ts.ModuleKind.Node16}
                // }).outputText
                // tstring=`const require = await import('module').then(m=>m.createRequire(import.meta.url));${tstring}`
                // console.log(tstring)
                // new Worker(new URL(`data:text/javascript,${encodeURIComponent(tstring)}`),{})
                // console.log('============transpileModule==========')

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
                const logger = await app.get<Logger>('log')
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
    Logger.info('this is a logger test')
    // app.exit()
})()
