import {Container} from '../lib/core/Container.js'
import {Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {Application} from '../lib/core/Application.js'
import path from 'node:path'
import {ModuleOptions} from '../options/ModuleOptions.js'
import {TestObj} from './unit/resources/glob-modules/TestObj.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Inject} from '../decorators/di/Inject.js'
import {OBJECT_ID} from '../options/LoadObjectOptions.js'
import {Delay} from '../lib/functions/Delay.js'
import {Time} from '../lib/Time.js'
import {EventEmitter} from '../lib/EventEmitter.js'


class XXX extends BaseObject {
    hahaha: string = 'hahahaah'

    public oh() {
        console.log('this.$id:', this.$id)
    }
}
class TestProvider extends BaseObject {

    @Configurable(DTO.String(), value => {
        return value
    })
    public aaaa: string

    protected num: number = 0

    protected buf: number[]

    // @Inject()
    // protected xx1: XXX

    protected async init(): Promise<void> {

    }

    public gg() {
        this.buf = new Array(20 * 1024 * 1024)
        console.log('i am test provider', this.num += 1, Time.now())
        // console.log(this.xx1)
        // this.xx1.oh()
    }

    protected hello() {
        return 'hello!!!!!!'
    }

    protected async destroy(): Promise<void> {
        console.log('TestProvider destroy')
    }
}

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value
    })
    public aaaa: string

    public gg() {
    }

    protected hello() {
        return 'hello!!!!!!'
    }

    protected async destroy(): Promise<void> {
        console.log('TestModule destroy111')
    }
}

(async () => {
    // const ctn: Container = new Container()
    // await ctn.load([{
    //     // id: 'abcd',
    //     class: TestModule,
    //     aaaa: '0'
    // }])
    // const instance = await ctn.get(TestModule)
    // console.log(instance.$id)

    // const instance: TestModule = await ctn.build(TestModule, {aaaa: '0'})
    // await instance.reload()
    // console.log(instance, isProxy(instance))
    const app = await Application.run({
        id: 'test.app',
        name: 'testApp',
        alias: {
            '@test1': '/home'
        },
        providers: {
            testProvider: {
                class: TestProvider,
                aaaa: path.resolve('@test', './test.file')
            }
        },
        modules: {
            testModule: {
                class: TestModule,
                aaaa: path.resolve('@test', './test.file')
            }
        }
    })

    // await Delay(1000)
    // console.log(await app.getObject('testModule'))
    // app.exit()
    const ctn = new Container()
    while (true) {
        await Delay(10)
        // const test: TestProvider | null = await app.getObject<TestProvider>('testProvider')
        const test: TestProvider = await ctn.build(TestProvider)
        test.gg()
        // test = null
        // new TestProvider({}).gg()
        // const tp=await ctn.build(TestProvider)
        // tp.gg()
    }
})()
