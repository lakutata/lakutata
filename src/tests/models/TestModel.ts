import {Model} from '../../lib/base/Model.js'
import {Configurable, Singleton} from '../../decorators/DependencyInjectionDecorators.js'


@Singleton()
export class TestModel extends Model {

    @Configurable()
    public greet: string

    public aa: string

    public bb: string

    protected async init(): Promise<void> {
        await super.init()
        console.log('hi!', this.greet, this.className)
    }
}
