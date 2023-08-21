import {Model} from '../../lib/base/Model'
import {Configurable, Scoped, Singleton} from '../../decorators/DependencyInjectionDecorators'


// @Singleton()
@Scoped()
export class TestModel extends Model {

    @Configurable()
    public greet: string

    public aa: string = '6666667'

    public bb: string

    protected async init(): Promise<void> {
        await super.init()
        console.log('hi!', this.greet, this.className)
    }

    protected async destroy(): Promise<void> {
        console.log('TestModel destroy!!!!!!!!!!!!!!!!!!!!!!!!')
    }
}
