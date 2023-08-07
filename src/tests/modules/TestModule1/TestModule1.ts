import {Module} from '../../../lib/base/Module.js'
import {Application} from '../../../lib/Application.js'
import {Inject} from '../../../decorators/DependencyInjectionDecorators.js'

export class TestModule1 extends Module {

    @Inject(Application)
    protected readonly app: Application

    protected async init(): Promise<void> {
        console.log('this is test module1')
    }
}
