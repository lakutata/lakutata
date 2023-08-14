import {Controller} from '../../lib/base/Controller.js'
import {Action} from '../../decorators/ControllerDecorators.js'
import {Configurable} from '../../decorators/DependencyInjectionDecorators.js'

export class Test1Controller extends Controller {

    @Configurable()
    public testBoolean: boolean

    @Action({a: 1})
    public async test() {
        return 'this is a equal 1'
    }

    @Action({a: 2})
    public async test1() {
        return 'this is a equal 2'
    }

    @Action({a: 1, b: 1})
    public async test2() {
        return 'this is a equal 1, b equal 1'
    }

    protected async init(): Promise<void> {
        console.log('Configurable variable in test controller1:', this.testBoolean)
    }

    protected async destroy(): Promise<void> {
        console.log(this.className, 'destroy!!!!!!')
    }
}
