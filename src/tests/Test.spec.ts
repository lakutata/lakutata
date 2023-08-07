import 'reflect-metadata'
import {Application} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'

(async () => {

    const app = await Application.run({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        mode: 'production',
        entries: {
            testComponent: {class: TestComponent, lifetime: 'SINGLETON', config: {greet: 'hello world'}},
            testObject: {class: TestObject, lifetime: 'SINGLETON', config: {username: 'tester'}},
            testInterval: {
                class: TestInterval,
                lifetime: 'SINGLETON',
                config: {
                    interval: 1000,
                    mode: 'SEQ'
                }
            }
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //     lifetime: 'SINGLETON',
            //     config: {tester: 'this is tester'}
            // }
        },
        modules: {
            tm: {class: TestModule1, config: {greet: 'oh!'}},
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
