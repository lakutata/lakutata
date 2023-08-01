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
import {async} from 'fast-glob'

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
        timezone: 'Asia/Shanghai'
    })

    class Test1 extends AsyncConstructor {
        protected ctn: IDependencyInjectionContainer

        constructor({ctn}) {
            super(async () => {
                console.log('test1')
                this.ctn = await ctn
                // throw new Error('ffff')
            })

        }

        public async ruuu() {
            const test2 = await this.ctn.resolve('test2')
            return test2.run()
        }

        public run() {
            return 'run!!!'
        }
    }

    class Test2 extends AsyncConstructor {
        protected test1: Test1

        constructor({test1}) {
            super(async () => {
                console.log('test2')
                this.test1 = await test1
            })

        }

        public run() {
            return this.test1.run()
        }
    }

    const container = createContainer({injectionMode: InjectionMode.PROXY})
    container.register({
        ctn: asValue(container),
        test1: asClass(Test1),
        test2: asClass(Test2)
    })
    const test1 = await container.resolve('test1')
    // console.log(test1)
    console.log(await test1.ruuu())

})()
