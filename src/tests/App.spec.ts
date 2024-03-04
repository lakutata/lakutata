import {Application} from '../lib/core/Application.js'
import {Container} from '../lib/core/Container.js'
import {Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {ObjectSchema} from '../lib/validation/interfaces/ObjectSchema.js'
import {VLD} from '../lib/validation/VLD.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Expect} from '../decorators/dto/Expect.js'
import {isProxy} from 'node:util/types'

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string
}

class TestDTO extends DTO {

    @Expect(DTO.String().default('haha'))
    bbbbbb: string
}

class TestDTO2 extends DTO {
    @Expect(TestDTO.required().options({stripUnknown:false}))
    objjj: TestDTO
}

(async () => {
    const ctn = new Container()
    const instance: TestModule = await ctn.build(TestModule, {aaaa: 'gggggg'})
    console.log(instance, isProxy(instance))

    const res=new TestDTO2({
        objjj:{
            bbbbb:123
        }
    })
    console.log(res)
    TestDTO2.validate()
})()
