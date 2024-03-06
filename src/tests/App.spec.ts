import {Container} from '../lib/core/Container.js'
import { Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {isProxy} from 'node:util/types'

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string

    public gg(){

    }

    protected hello(){
        return 'hello!!!!!!'
    }
}

(async () => {
    const ctn: Container = new Container()
    const instance: TestModule = await ctn.build(TestModule, {aaaa: '0'})
    await instance.reload()
    console.log(instance, isProxy(instance))

})()
