import 'reflect-metadata'
import {Application, ApplicationOptions, DTO} from '../Core.js'
// import {Application} from '../lib/Application.js'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'
import {Validator} from '../Validator.js'
import {Accept} from '../Decorators.js'
import {IDependencyInjectionContainer, createContainer} from '../lib/ioc/DependencyInjectionContainer.js'
import {InjectionMode} from '../lib/ioc/InjectionMode.js'
import {AsyncConstructor} from 'async-constructor'
import {Container} from '../lib/base/Container.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {Component} from '../lib/base/Component.js'
import {Configurable, Inject} from '../decorators/DependencyInjectionDecorators.js'
import {LoadEntryCommonOptions} from '../options/LoadEntryCommonOptions.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {Crypto} from '../Crypto.js'
import {LoadEntryClassOptions} from '../options/LoadEntryClassOptions.js'
import {ParentConstructor} from '../Utilities.js'

// console.log(Application)

// new Application({
//     id: 'test',
//     name: 'test'
//     // timezone: 'Asia/Shanghai'
// })

(async () => {

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
            // return test2.run()
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

    // console.log('typeof Test2:', typeof Test2)

    const ctr = createContainer({injectionMode: InjectionMode.PROXY})
    const container = new Container()

    // const test1 = await container.get('test1')
    // console.log(test1)
    // console.log(await test1.ruuu())

    class PPP {
    }

    class OB extends Component {

        protected readonly test: string

        @Configurable()
        protected readonly oo

        protected async init(): Promise<void> {
            console.log('dfdfdf')
        }

        public async testRun() {
            return 'hahahahah' + this.oo
        }
    }

    // console.log(await new OB({test: 'world'}))
    // const obInstance = await OB.instantiate({test1: 'world111'})
    // obInstance.setProperty('test1', 'gg')
    // console.log(obInstance,obInstance['init'], obInstance.hasProperty('init'), obInstance.hasMethod('init'))

    // console.log(await container.get('base'))
    // console.log(await container.get('ob'))
    // console.log(await container.get('test2'))
    // console.log(await container.get('test1'))

    const app = await new Application({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        entries: {
            ob: {class: OB, lifetime: 'SINGLETON', config: {oo: 'kkkkkkk'}},
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //     lifetime: 'SINGLETON',
            //     config: {tester: 'this is tester'}
            //     // class: OB
            // }
        }
    })

    await app.exit()

    // new LoadEntryClassOptions()

    // await container.load({
    //     '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
    //         lifetime: 'SINGLETON',
    //         config: {tester: 'this is tester'}
    //         // class: OB
    //     },
    //     ob: {
    //         class: OB
    //     }
    // })
    //
    // console.log(await container.get(MDSTest1))

})()
