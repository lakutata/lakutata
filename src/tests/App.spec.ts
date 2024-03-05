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
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

class TestModule extends Module {
    @Configurable(DTO.String(), value => {
        return value + '123456'
    })
    public aaaa: string
}

class TestDTO extends DTO {

    @Expect(DTO.String().default('haha'))
    bbbbbb: string

    @Expect(DTO.Object({
        nnnn: DTO.Object({
            qqqqq: DTO.Object({
                val: DTO.String(),
                num: DTO.Number()
            })
        })
    }).default({
            nnnn: {
                qqqqq: {
                    val: 'vvvvv',
                    num: 11111
                }
            }
        })
    //     .default({
    //     nnnn: {
    //         qqqqq: {
    //             val: 'vvvvv',
    //             num: 11111
    //         }
    //     }
    // })
    )
    sub: {
        nnnn: {
            qqqqq: {
                val: string
                num: number
            }
        }
    }
}

// @IndexSignature(DTO.String())
class TestDTO2 extends DTO {
    @Expect(TestDTO.required().options({stripUnknown: true}))
    objjj: TestDTO


    @Expect(DTO.String().required())
    testString: any
}

(async () => {
    // const ctn = new Container()
    // const instance: TestModule = await ctn.build(TestModule, {aaaa: 'gggggg'})
    // console.log(instance, isProxy(instance))

    const res = new TestDTO2({
        objjj: {
            bbbbb: 123
            // sub:{
            //     nnnn: {
            //         qqqqq: {
            //             val: 'vvvvv',
            //             num: 11111
            //         }
            //     }
            // }
        },
        testString: 'asdasd'
    })
    // @ts-ignore
    res.objjj.sub.nnnn.qqqqq.num = 'bbbbbb'
    // @ts-ignore
    // res.objjj.bbbbbb = 'ddddd'

    // delete res.testString

    // @ts-ignore
    // res.testString = 123456

    console.log('RES=========:',JSON.stringify(res, null, 2))
    // console.log('===:', JSON.stringify(TestDTO2.validate({
    //     // objjj: {
    //     //     bbbbb: 123
    //     // },
    //     objjj:new TestDTO(),
    //     pp: '12323'
    // }, {stripUnknown: false})))

})()
