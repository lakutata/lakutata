import {__dirname, __filename} from '../lib/NodeCJS.js'
import {createRequire} from 'node:module'
import * as path from 'path'
import {MD5} from 'crypto-js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {createContainer} from '../lib/ioc/DependencyInjectionContainer.js'
import {asClass, asFunction} from '../lib/ioc/Resolvers.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {GetObjectConfigurablePropertiesByConstructor} from '../lib/base/internal/ObjectConfiguration.js'
import {Inject} from '../decorators/di/Inject.js'
import {GetObjectInjectItemsByConstructor} from '../lib/base/internal/ObjectInjection.js'
import {Container} from '../lib/core/Container.js'
import {Injectable} from '../decorators/di/Injectable.js'
import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {ValidateOptions} from '../decorators/dto/ValidateOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'
import {GetObjectIndexSignatureSchemaByConstructor, IsDTO} from '../lib/base/internal/ObjectSchemaValidation.js'
import {Accept} from '../decorators/dto/Accept.js'
import {Return} from '../decorators/dto/Return.js'

(async () => {
    // class XX extends BaseObject {
    //     @Configurable()
    //     public xx1: any
    // }
    //
    // class XX1 extends XX {
    //     @Configurable()
    //     public xx2: any
    //
    //     @Configurable()
    //     public xx3: any
    //
    //     @Inject()
    //     // protected readonly aaa: XX1
    //     protected readonly aaa: XX
    // }
    //
    // class XX2 extends XX1 {
    //     @Inject()
    //     // protected readonly aaa: XX1
    //     protected readonly aaa: XX1 = {} as any
    //
    //     @Configurable()
    //     public xx4: any = 1
    //
    //     @Configurable()
    //     public xx5: any
    // }
    //
    // const ctn = new Container()
    // const xx2=await ctn.get(XX2)
    // console.log(xx2)
    // const xx2 = await new XX2()
    // console.log(xx2.propertyNames())


    @ValidateOptions({stripUnknown: false})
    class Abc extends DTO {
        @Expect(DTO.String().required())
        public aa: string

        @Expect(DTO.Object({
            lll: DTO.Number().required()
        }).required().options({stripUnknown: false}))
        public cccccc: {
            lll: number
        }
    }

    @IndexSignature(DTO.Alternatives(DTO.String(), DTO.Number()))
    class Efg extends Abc {
        @Expect(DTO.Number().default(667))
        public bb?: number

        @Expect(Abc.Schema())
        public nnnnn: any
    }

    // const abc = new Abc()
    // console.log(abc)
    // const efg = new Efg({
    //     aa: 'aaa', hahha: 123, nnnnn: {
    //         aa: 'pppp',
    //         okokok: true
    //     }
    // })
    // console.log(abc)
    // @ts-ignore
    // efg.aa = '1111'
    // // efg.bb = 777777
    // // efg.bb = undefined
    // delete efg.bb
    //
    // console.log(efg)
    // const efg2 = new Efg({aa: 'aaa'})
    // console.log(efg2)
    //
    // efg2.okk = 'true'
    // console.log(efg2)
    // // console.log(DTO.validate({bb: 1},DTO.Object({
    // //     aa: DTO.String().required()
    // // })))

    class XXX {

        @Accept(Abc.Schema(), DTO.Alternatives(DTO.Number(), DTO.String()).required())
        @Return(Abc)
        public async func(...args: any[]) {
            console.log('oh!')
            return args[0]
        }

    }

    console.log(await new XXX().func({aa: 'aa', opopop: true, cccccc: {lll: 111, kkk: true}}, '1111'))

})()
