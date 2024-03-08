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
import {Delay} from '../lib/base/functions/Delay.js'

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

    // @Inject()
    // protected xx1: XXX

    public gg() {
        // console.log(this.xx1)
        // this.xx1.oh()
    }

    protected hello() {
        return 'hello!!!!!!'
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
        console.log('TestModule destroy')
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
        modules: {
            testModule: {
                class: TestModule,
                aaaa: path.resolve('@test', './test.file')
            }
        }
    })

    await Delay(1000)
    app.exit(true)
})()
