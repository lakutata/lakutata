import {Application} from '../lib/core/Application.js'
import {TestComponent} from './components/TestComponent.js'
import {TestModule} from './modules/TestModule.js'
import {TestProvider} from './providers/TestProvider.js'

(async (): Promise<void> => {
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
        bootstrap: [
            'testModule',
            'testComponent',
            async (target): Promise<void> => {
                const testComponent = await target.getObject<TestComponent>('testComponent')
                const testModule = await target.getObject<TestModule>('testModule')
                testComponent.on('testComponentEvent', (timeStr: string) => console.log('Receive testComponentEvent    ', timeStr))
                testModule.on('testModuleEvent', (timeStr: string) => console.log('Receive testModuleEvent       ', timeStr))
            }
        ]
    })
})()
