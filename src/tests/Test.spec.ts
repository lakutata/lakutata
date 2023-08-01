import 'reflect-metadata'
import {Application, ApplicationOptions, DTO} from '../Core.js'
// import {Application} from '../lib/Application.js'
import {InvalidMethodAcceptException} from '../exceptions/InvalidMethodAcceptException.js'
import {Validator} from '../Validator.js'
import {Accept} from '../Decorators.js'
import {IContainer, createContainer} from '../lib/ioc/Container.js'
import {InjectionMode} from '../lib/ioc/InjectionMode.js'
import {asClass, asValue} from '../lib/ioc/Resolvers.js'

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

    class Test1 {
        protected readonly ctn: IContainer

        constructor({ctn}) {
            console.log('test1')
            this.ctn = ctn
            // throw new Error('ffff')
        }

        public ruuu() {
            return this.ctn.resolve('test2').run()
        }

        public run() {
            return 'run!!!'
        }
    }

    class Test2 {
        protected readonly test1: Test1

        constructor({test1}) {
            console.log('test2')
            this.test1 = test1
        }

        public run() {
            return this.test1.run()
        }
    }

    const container = createContainer({injectionMode: InjectionMode.PROXY})
    container.register({
        ctn: asValue(container),
        test1: asClass(Test1, {lifetime: 'SINGLETON'}),
        test2: asClass(Test2)
    })

    console.log(container.resolve('test1').ruuu())

})()
