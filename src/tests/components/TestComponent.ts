import {Application, ApplicationOptions, Component} from '../../Core.js'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators.js'

export class TestComponent extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Configurable()
    public readonly greet: string

    protected async init(): Promise<void> {
        console.log(this.className, 'init', this.greet)
        // if (this.greet === 'subModule') {
        //     setTimeout(() => {
        //         this.app.exit()
        //     }, 5000)
        // }
    }

    public sayHello(invoker: string): string {
        return `${invoker} as me to say hello`
    }

    protected async destroy(): Promise<void> {
        console.log('testComponent destroy')
    }
}
