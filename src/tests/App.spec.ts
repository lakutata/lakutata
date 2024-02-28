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
import {LoadObjectOptions} from '../options/LoadObjectOptions.js'
import {EventEmitter} from '../lib/EventEmitter.js'
import {ContainerLoadOptions} from '../options/ContainerLoadOptions.js'

(async () => {

    class XX extends BaseObject {
        @Configurable()
        public xx1: any
    }

    class XX1 extends XX {
        // @Configurable()
        // public xx2: any

        @Configurable()
        public xx3: any

        @Inject()
        // protected readonly aaa: XX1
        protected readonly aaa: XX
    }

    class XX2 extends BaseObject {
        // @Inject()
        // // protected readonly aaa: XX1
        // protected readonly aaa: XX1 = {} as any

        @Configurable()
        public xx4: any = 1

        @Configurable()
        public xx5: any

        protected async init(): Promise<void> {
            console.log(this)
        }

    }

    const ctn = new Container()

    const obj: ContainerLoadOptions = {
        xx1: XX1,
        xx2: {
            class: XX2,
            xx4: 222
        }
    }
    obj[Symbol('test')] = XX1

    await ctn.load(obj)
    const xx2 = await ctn.get<XX2>('xx2')
    console.log(xx2)
})()
