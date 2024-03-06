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

class XXX extends BaseObject {

}

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string

    @Inject()
    protected readonly xx: XXX

    public gg() {

    }

    protected hello() {
        return 'hello!!!!!!'
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
    // await Application.run({})

    const opt: ModuleOptions = {
        objects: [
            TestModule,
            {
                id:'xx',
                class:XXX
            },
            {
                id: 'testModule',
                class: TestModule
            },
            {
                id: 'testModule',
                class: TestModule
            },
            `${process.cwd()}/distro/src/tests/unit/resources/glob-modules/*.js`
        ],
        bootstrap: ['abcd', TestModule, async (target): Promise<void> => {
        }]
    }
    const options: ModuleOptions = new ModuleOptions(opt)
    const ctn: Container = new Container()
    await ctn.load(options.objects ? options.objects : [])
    console.log(await ctn.get(TestObj))
    console.log(await ctn.get('testModule'))
})()
