import {Application} from '../lib/core/Application.js'
import {Container} from '../lib/core/Container.js'
import {Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'

class TestModule extends Module {
    @Configurable(DTO.String())
    public aaaa: number
}

(async () => {
    const ctn = new Container()
    const instance: TestModule = await ctn.build(TestModule, {aaaa:12345})
    console.log(instance)
})()
