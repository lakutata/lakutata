import {Component} from '../../Core.js'
import {Configurable} from '../../decorators/DependencyInjectionDecorators.js'

export class TestComponent extends Component {

    @Configurable()
    public readonly greet: string

    protected async init(): Promise<void> {
        console.log(this.className, 'init', this.greet)
    }
}
