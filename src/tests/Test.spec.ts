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
import {Delay, ParentConstructor} from '../Utilities.js'
import {Interval} from '../lib/base/abstracts/Interval.js'
import {MDSTest0} from './mds/MDSTest0.js'

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

    class IntervalTest extends Interval {

        // @Inject(Application)
        // protected readonly app: Application

        @Configurable()
        protected readonly output: string

        protected count: number = 0

        protected async executor(): Promise<void> {
            console.log('count:', ++this.count, this.output, this.constructor.name)
        }
    }


    new Application({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        entries: {
            ob: {class: OB, lifetime: 'SINGLETON', config: {oo: 'kkkkkkk'}},
            itv: {class: IntervalTest, lifetime: 'SINGLETON', config: {interval: 1000, mode: 'SEQ', output: 'hi!'}},
            itv2: {class: IntervalTest, lifetime: 'SINGLETON', config: {interval: 500, mode: 'SEQ', output: 'oh!'}}
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //     lifetime: 'SINGLETON',
            //     config: {tester: 'this is tester'}
            //     // class: OB
            // }
        },
        bootstrap: [
            'itv2',
            'ob',
            'itv',
            async (x: Application) => {
            }
        ]
    })

    // await app.exit()

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
