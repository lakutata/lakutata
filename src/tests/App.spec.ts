import {Container} from '../lib/core/Container.js'
import {Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {isProxy} from 'node:util/types'
import {Application} from '../lib/core/Application.js'
import path from 'node:path'
import {ModuleOptions} from '../options/ModuleOptions.js'

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string

    public gg() {

    }

    protected hello() {
        return 'hello!!!!!!'
    }
}

(async () => {
    const ctn: Container = new Container()
    await ctn.load([{
        // id: 'abcd',
        class: TestModule,
        aaaa: '0'
    }])
    const instance = await ctn.get(TestModule)
    console.log(instance.$id)

    // const instance: TestModule = await ctn.build(TestModule, {aaaa: '0'})
    // await instance.reload()
    // console.log(instance, isProxy(instance))
    // await Application.run({})
    // console.log(new ModuleOptions({
    //     bootstrap: ['abcd', TestModule, async () => {
    //     }]
    // }))
})()
