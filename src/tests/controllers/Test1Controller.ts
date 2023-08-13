import {Controller} from '../../lib/base/Controller.js'
import {Action} from '../../decorators/ControllerDecorators.js'

export class Test1Controller extends Controller {

    @Action({a:1})
    public test(){}

    @Action({b:2})
    public test1(){}
}
