import {Component} from '../../lib/base/Component.js'
import {Application} from '../../lib/Application.js'
import {Inject, InjectApp, InjectModule} from '../../decorators/DependencyInjectionDecorators.js'
import {TestModule1} from '../modules/TestModule1/TestModule1.js'

export class SubTestComponent extends Component {

    @InjectApp()
    protected readonly app: Application

    @InjectModule()
    protected readonly module: TestModule1

    protected async init(): Promise<void> {
        console.log('this is ', this.className)
    }

}
