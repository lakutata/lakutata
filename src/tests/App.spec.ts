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

(async () => {
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

    const ctn=new Container()
    // const xx2=await ctn.get(XX2)
    // console.log(xx2)
    // const xx2 = await new XX2()
    // console.log(xx2.propertyNames())

    class Abc extends DTO{
        aa
    }

    console.log(new Abc())
})()
