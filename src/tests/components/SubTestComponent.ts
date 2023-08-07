import {Component} from '../../lib/base/Component.js'
import {Application} from '../../lib/Application.js'
import {Inject, InjectApp, InjectModule} from '../../decorators/DependencyInjectionDecorators.js'
import {TestModule1} from '../modules/TestModule1/TestModule1.js'
import {TestComponent} from './TestComponent.js'

export class SubTestComponent extends Component {

    @InjectApp()
    protected readonly app: Application

    @InjectModule()
    protected readonly module: TestModule1

    @Inject()
    protected readonly tt11: TestComponent

    protected async init(): Promise<void> {
        console.log('this is ', this.className)
        console.log(this.tt11.sayHello(this.className))
    }

}
