import 'reflect-metadata'
import {Application, ApplicationOptions, DTO} from '../Core.js'
// import {Application} from '../lib/Application.js'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'
import {Validator} from '../Validator.js'
import {Accept} from '../Decorators.js'
import {IDependencyInjectionContainer, createContainer} from '../lib/ioc/DependencyInjectionContainer.js'
import {InjectionMode} from '../lib/ioc/InjectionMode.js'
import {asClass, asValue} from '../lib/ioc/Resolvers.js'
import {AsyncConstructor} from 'async-constructor'
import {Container} from '../lib/base/Container.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Component} from '../lib/base/Component.js'
import {Configurable, Inject} from '../decorators/DependencyInjectionDecorators.js'
import {DI_CONTAINER_CREATOR_CONSTRUCTOR} from '../constants/MetadataKey.js'
import {LoadEntryCommonOptions} from '../options/LoadEntryCommonOptions.js'

// console.log(Application)

// new Application({
//     id: 'test',
//     name: 'test'
//     // timezone: 'Asia/Shanghai'
// })

(async () => {

    await new Application({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        entries: []
    })

    class Test1 extends AsyncConstructor {
        protected ctn: Container

        constructor({ctn}) {
            super(async () => {
                console.log('test1')
                this.ctn = await ctn
                // throw new Error('ffff')
            })

        }

        public async ruuu() {
            const test2 = await this.ctn.get('test2')
            return test2.run()
        }

        public run() {
            return 'run!!!'
        }
    }

    class Test2 extends Component {
        @Inject()
        protected test1: Test1

        // @Inject()
        // protected ob:OB

        public run() {
            // return this.test1.run()
        }
    }

    console.log('typeof Test2:', typeof Test2)

    const ctr = createContainer({injectionMode: InjectionMode.PROXY})
    const container = new Container()

    // const test1 = await container.get('test1')
    // console.log(test1)
    // console.log(await test1.ruuu())

    class PPP {
    }

    class OB extends Component {

        protected readonly test: string

        @Inject()
        protected readonly test1: Test1

        @Inject()
        protected readonly test2: Test2

        @Inject()
        protected readonly ctn

        @Configurable()
        protected readonly oo

        protected readonly hh = () => {
        }

        protected async init(): Promise<void> {
            console.log('dfdfdf')
        }
    }

    // console.log(await new OB({test: 'world'}))
    // const obInstance = await OB.instantiate({test1: 'world111'})
    // obInstance.setProperty('test1', 'gg')
    // console.log(obInstance,obInstance['init'], obInstance.hasProperty('init'), obInstance.hasMethod('init'))

    container.register({
        ctn: asValue(container),
        test1: asClass(Test1),
        test2: asClass(Test2),
        ob: asClass(OB, {
            injector: (container) => {
                return Object.assign({}, container.registrations, {pppppppp: 'dddddd'})
                // const obj= {nnnnnnnnnn: 'abcd'}
                // Reflect.defineMetadata(DI_CONTAINER_CREATOR_CONSTRUCTOR,true,obj)
                // return obj
            }
        })
    })

    // console.log(await container.get('base'))
    console.log(await container.get('ob'))
    console.log(await container.get('test2'))
    // console.log(await container.get('test1'))

    container.load({
        'testjs': {
            // lifetime: 'SINGLETON',
            // params: {}
            // class: OB
        }
    })
})()
