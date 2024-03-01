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
import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {ValidateOptions} from '../decorators/dto/ValidateOptions.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'
import {GetObjectIndexSignatureSchemaByConstructor, IsDTO} from '../lib/base/internal/ObjectSchemaValidation.js'
import {Accept} from '../decorators/dto/Accept.js'
import {Return} from '../decorators/dto/Return.js'
import {LoadObjectOptions} from '../options/LoadObjectOptions.js'
import {EventEmitter} from '../lib/EventEmitter.js'
import {Autoload} from '../decorators/di/Autoload.js'
import {TestObj} from './unit/resources/glob-modules/TestObj.js'
import {GetObjectContainer} from '../lib/base/internal/ObjectContainer.js'

(async () => {

    class XX extends BaseObject {
        @Configurable()
        public xx0: any
    }

    class XX1 extends XX {
        // @Configurable()
        // public xx2: any

        @Configurable()
        public xx3: any

        @Inject()
        // protected readonly aaa: XX1
        protected readonly xx: XX
    }

    @Autoload()
    class BBBBB extends BaseObject {
        public abcd: number = 123456
    }

    class XX2 extends XX1 {
        // @Inject()
        // // protected readonly aaa: XX1
        // protected readonly aaa: XX1 = {} as any

        @Configurable()
        public xx4: any = 1

        @Configurable()
        public xx5: any

        @Inject()
        protected readonly testObj: TestObj

        @Inject()
        protected readonly xx1: XX1

        @Inject()
        protected readonly bbbbb: BBBBB

        protected async init(): Promise<void> {
            console.log(await this.instantiateObject(UNNN, {aaa: 2}))
            // console.log(await ctn.build(UNNN, {aaa: 1}))
            console.log(await GetObjectContainer(this).build(UNNN, {aaa: 3}))
        }
    }

    class UNNN extends BaseObject {
        @Configurable()
        aaa: number
    }

    const ctn = new Container()

    const obj: (LoadObjectOptions | typeof BaseObject | string)[] = [
        {
            id: 'xx1',
            class: XX1
        },
        {
            id: 'xx2',
            class: XX2,
            xx4: 222
        },
        {
            id: Symbol('test'),
            class: XX1
        },
        {
            class: XX
        },
        XX,
        `${path.resolve(__dirname, './unit/resources/glob-modules')}/**`
    ]

    obj[Symbol('test')] = XX1

    await ctn.load(obj)
    const xx2 = await ctn.get<XX2>('xx2')
    // // console.log(xx2)
    // // class Test extends Array{}
    //
    // // new Array()[Symbol.iterator]
    //
    // // @ts-ignore
    // console.log(new VVV({mm: false}), new VV1({mm: true}))

    // console.log(DTO.validate(new Test(),DTO.Array()))


    const config = {
        components: [
            {
                id: 'abc',
                class: XX1
            },
            {
                class: XX2
            }
        ]
    }
})()
