import {Application} from '../lib/core/Application.js'
import {TestComponent} from './components/TestComponent.js'
import {TestModule} from './modules/TestModule.js'
import {TestProvider} from './providers/TestProvider.js'
import {TestController1} from './controllers/TestController1.js'
import {PatternManager} from '../lib/base/internal/PatternManager.js'
import {DTO} from '../lib/core/DTO.js'
import {Stream} from 'node:stream'
import path from 'node:path'
import {HTTPContext} from '../lib/context/HTTPContext.js'

(async (): Promise<void> => {

    console.log(new HTTPContext({
        route: '/test',
        method: 'get'
    }))
    return
    const pm = new PatternManager()
    pm.add({test: true, abc: 123}, function () {
        console.log('hello world')
    })

    console.log(pm.find({test: true, abc: 123}))


    await Application.run({
        id: 'test.app',
        name: 'TestApp',
        timezone: 'auto',
        components: {
            testComponent: {
                class: TestComponent
            }
        },
        providers: {
            testProvider: {
                class: TestProvider
            }
        },
        modules: {
            testModule: {
                class: TestModule
            }
        },
        controllers: [
            TestController1
        ],
        bootstrap: [
            'testModule',
            'testComponent',
            // async (target): Promise<void> => {
            //     const testComponent = await target.getObject<TestComponent>('testComponent')
            //     const testModule = await target.getObject<TestModule>('testModule')
            //     testComponent.on('testComponentEvent', (timeStr: string) => console.log('Receive testComponentEvent    ', timeStr))
            //     testModule.on('testModuleEvent', (timeStr: string) => console.log('Receive testModuleEvent       ', timeStr))
            // },
            async (target): Promise<void> => {
                const testController1 = await target.getObject(TestController1)
                await testController1.test('a', 1)
            }
        ]
    })
})()
