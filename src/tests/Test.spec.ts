import 'reflect-metadata'
import {Application} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'
import {TestModule1} from './modules/TestModule1/TestModule1.js'

(async () => {


    await Application.run({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        entries: {
            testComponent: {class: TestComponent, lifetime: 'SINGLETON', config: {greet: 'hello world'}},
            testObject: {class: TestObject, lifetime: 'SINGLETON', config: {username: 'tester'}},
            testInterval: {
                class: TestInterval, lifetime: 'SINGLETON', config: {
                    interval: 1000,
                    mode: 'SEQ'
                }
            },
            tm: {class: TestModule1, lifetime: 'SINGLETON'}
            // '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
            //     lifetime: 'SINGLETON',
            //     config: {tester: 'this is tester'}
            // }
        },
        // modules:{},
        bootstrap: [
            'tm',
            'testInterval',
            async (x: Application) => {
                console.log('dfsdfsdfs111111')
            }
        ]
    })
})()
