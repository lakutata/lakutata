import {Component} from '../../lib/base/Component'
import {Application} from '../../lib/Application'
import {Inject, InjectApp, InjectModule} from '../../decorators/DependencyInjectionDecorators'
import {TestModule1} from '../modules/TestModule1/TestModule1'
import {TestComponent} from './TestComponent'

export class SubTestComponent extends Component {

    @InjectApp()
    protected readonly app: Application

    @Inject()
    protected readonly tt11: TestComponent

    protected async init(): Promise<void> {
        console.log('ohohoh!this is ', this.className)
        console.log(this.tt11.sayHello(this.className))
    }

}
