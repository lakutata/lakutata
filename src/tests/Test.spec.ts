import 'reflect-metadata'
import {App} from '../Core.js'
import {MDSTest1} from './mds/MDSTest1.js'
import {TestComponent} from './components/TestComponent.js'
import {TestObject} from './objects/TestObject.js'
import {TestInterval} from './intervals/TestInterval.js'

(async () => {
    new App({
        id: 'test',
        name: 'test',
        timezone: 'Asia/Shanghai',
        entries: {
            testComponent: {class: TestComponent, lifetime: 'SINGLETON', config: {greet: 'hello world'}},
            testObject: {class: TestObject, lifetime: 'SINGLETON', config: {username: 'tester'}},
            testInterval: {
                class: TestInterval, lifetime: 'SINGLETON', config: {
                    interval: 500, mode: 'SEQ'
                }
            },
            '/Users/alex/WebstormProjects/core/src/tests/mds/**/*': {
                lifetime: 'SINGLETON',
                config: {tester: 'this is tester'}
            }
        },
        bootstrap: [
            'testInterval',
            async (x: App) => {
                console.log('dfsdfsdfs111111')
            }
        ]
    })
})()
