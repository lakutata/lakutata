import {Controller} from '../../lib/base/Controller.js'
import {Action} from '../../decorators/ControllerDecorators.js'

export class Test1Controller extends Controller {

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

    protected async destroy(): Promise<void> {
        console.log(this.className, 'destroy!!!!!!')
    }
}
