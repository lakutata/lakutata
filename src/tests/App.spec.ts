import {Application} from '../lib/core/Application.js'
import {Container} from '../lib/core/Container.js'
import {Module} from '../lib/core/Module.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {ObjectSchema} from '../lib/validation/interfaces/ObjectSchema.js'
import {VLD} from '../lib/validation/VLD.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {BaseObject} from '../lib/base/BaseObject.js'

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string
}

class TestDTO extends DTO {

}

(async () => {
    const ctn = new Container()
    const instance: TestModule = await ctn.build(TestModule, {aaaa: 'gggggg'})
    console.log(instance)

    // @ts-ignore
    const obj: ObjectSchema = {}

    const XXX: TestDTO & ObjectSchema = Object.assign(TestDTO, obj)

    // ObjectDTO
    //
    // StringDTO

    class MM extends DTO {
        [key: string | symbol]: never
    }

    // class CCCC extends MM{
    //     xxx:string
    // }

    // class StringDTO extends String implements IConstructor<any>{
    //     [prop: string]: any
    //     static [key: string | symbol]:unknown
    // }
    //
    // const xx:InstanceType<IConstructor>={}
    //
    // StringDTO.xx=function (){}
    //
    // const gg: StringDTO = 'ddd'

    // TestDTO.required().optional()


})()
