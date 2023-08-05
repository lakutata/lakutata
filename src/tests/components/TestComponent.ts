import {App, Component} from '../../Core.js'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators.js'

export class TestComponent extends Component {

    // @Inject()
    // protected readonly app: App

    @Configurable()
    public readonly greet: string

    protected async init(): Promise<void> {
        console.log(this.className, 'init', this.greet)
    }
}
