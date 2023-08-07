import {Application, ApplicationOptions, Component} from '../../Core.js'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators.js'

export class TestComponent extends Component {

    @Inject(Application)
    protected readonly app: Application

    @Configurable()
    public readonly greet: string

    protected async init(): Promise<void> {
        console.log(this.className, 'init', this.greet)
        // setTimeout(()=>{
        //     this.app.exit()
        // },5000)
    }

    protected async destroy(): Promise<void> {
        console.log('testComponent destroy')
    }
}
