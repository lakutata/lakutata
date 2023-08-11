import 'reflect-metadata'
import {Application, BaseObject, DTO} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'
import {Accept, Expect, IndexSignature} from '../decorators/ValidationDecorators.js'
import {Validator} from '../Validator.js'
import {RandomString} from '../Utilities.js'

(async () => {

    const app = await Application.run({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        mode: 'production',
        entries: {
            testObject: {class: TestObject, username: 'tester'},
            testInterval: {
                class: TestInterval,
                interval: 1000,
                mode: 'SEQ'
            }
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //     config: {tester: 'this is tester'}
            // }
        },
        components: {
            testComponent: {class: TestComponent,greet: 'hello world'}
        },
        modules: {
            tm: {class: TestModule1, greet: 'oh!'},
            tm1: TestModule1
        },
        bootstrap: [
            'tm',
            'tm1',
            'testInterval',
            async (app: Application) => {
                console.log('app.mode():', app.mode())
            }
        ]
    })
    // app.exit()
})()
