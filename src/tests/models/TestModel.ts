import {Model} from '../../lib/base/Model.js'
import {Configurable, Scoped, Singleton} from '../../decorators/DependencyInjectionDecorators.js'


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
