import {Application} from '../lib/core/Application.js'
import {Container} from '../lib/core/Container.js'
import {Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {VLD} from '../lib/validation/VLD.js'

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string
}

(async () => {
    const ctn = new Container()
    const instance: TestModule = await ctn.build(TestModule, {aaaa: 'gggggg'})
    console.log(instance)

    VLD.array().items(VLD.string())
})()
