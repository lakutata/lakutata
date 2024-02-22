import {__dirname, __filename} from '../lib/NodeCJS.js'
import {createRequire} from 'node:module'
import * as path from 'path'
import {MD5} from 'crypto-js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {createContainer} from '../lib/ioc/DependencyInjectionContainer.js'
import {asClass, asFunction} from '../lib/ioc/Resolvers.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {GetObjectConfigurablePropertiesByConstructor} from '../lib/base/internal/ObjectConfiguration.js'

(async () => {
    const ctn = createContainer({injectionMode: 'PROXY', strict: true})
    ctn.register({
        testFn: asFunction(function () {
            return 'oh my god!'
        }),
        testObj: asClass(BaseObject)
    })
    const testFn = ctn.resolve<Function>('testFn')
    const testObj = ctn.resolve('testObj')

    // console.log(testObj)


    class XX extends BaseObject {
        @Configurable()
        public xx1: any
    }

    class XX1 extends XX {
        @Configurable()
        public xx2: any

        @Configurable()
        public xx3: any
    }

    class XX2 extends XX {
        @Configurable()
        public xx4: any
    }

    console.log(GetObjectConfigurablePropertiesByConstructor(XX))
    console.log(GetObjectConfigurablePropertiesByConstructor(XX1))
    console.log(GetObjectConfigurablePropertiesByConstructor(XX2))

})()
