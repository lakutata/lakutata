import {__dirname, __filename} from '../lib/NodeCJS.js'
import {createRequire} from 'node:module'
import * as path from 'path'
import {MD5} from 'crypto-js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {createContainer} from '../lib/ioc/DependencyInjectionContainer.js'
import {asFunction} from '../lib/ioc/Resolvers.js'

(async () => {
    const ctn = createContainer({injectionMode: 'CLASSIC', strict: true})
    ctn.register({
        testFn: asFunction(function () {
            return 'oh my god!'
        })
    })

    ctn.cradle.testFn()
})()
