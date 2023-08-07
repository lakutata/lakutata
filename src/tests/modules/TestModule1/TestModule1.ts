import {Module} from '../../../lib/base/Module.js'
import {Application} from '../../../lib/Application.js'
import {Configurable, Inject} from '../../../decorators/DependencyInjectionDecorators.js'

export class TestModule1 extends Module {

    @Inject(Application)
    protected readonly app: Application

    @Configurable()
    protected readonly greet: string

    protected async init(): Promise<void> {
        await super.init()
        console.log('this is test from ', this.greet ? this.greet : this.className)
    }
}
