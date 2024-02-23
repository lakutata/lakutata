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
import {ConstructorHash} from '../lib/base/func/ConstructorHash.js'
import {Container} from '../lib/base/Container.js'
import {Injectable} from '../decorators/di/Injectable.js'

(async () => {
    const ctn = createContainer({injectionMode: 'PROXY', strict: true})
    const sym = Symbol('ddd')
    // ctn.register({
    //     testFn: asFunction(function () {
    //         return 'oh my god!'
    //     }),
    //     testObj: asClass(BaseObject),
    //     ['ddd']: asClass(BaseObject)
    // })
    const gg = {
        testFn: asFunction(function () {
            return 'oh my god!'
        }),
        testObj: asClass(BaseObject)
    }
    gg[sym] = asClass(BaseObject)
    ctn.register(gg)
    const testFn = ctn.resolve<Function>('testFn')
    const testObj = ctn.resolve('testObj')
    const testObj1 = ctn.resolve(sym)

    console.log('dddddd', testObj1)


    class XX extends BaseObject {
        @Configurable()
        public xx1: any
    }

    class XX1 extends XX {
        @Configurable()
        public xx2: any

        @Configurable()
        public xx3: any

        @Inject()
        // protected readonly aaa: XX1
        protected readonly aaa: XX
    }

    class XX2 extends XX1 {
        @Inject()
        // protected readonly aaa: XX1
        protected readonly aaa: XX1 = {} as any

        @Configurable()
        public xx4: any = 1

        @Configurable()
        public xx5: any
    }

    const xx2 = await new XX2()
    console.log(xx2.propertyNames())

})()
