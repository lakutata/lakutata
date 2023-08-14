import {Controller} from '../../lib/base/Controller.js'
import {Action} from '../../decorators/ControllerDecorators.js'
import {Configurable} from '../../decorators/DependencyInjectionDecorators.js'
import {Test2Controller} from './Test2Controller.js'

export class Test1Controller extends Controller {

    @Configurable()
    public testBoolean: boolean

    @Action({a: 1})
    public async test(inp) {
        return await this.test1(inp)
        // return this
    }

    @Action({a: 2})
    public async test1(inp) {
        console.log('this is test1 method, the inp is:', inp)
        return this.forward(Test2Controller, Object.assign(inp, {test2: true}))
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

    async beforeAction(subject: Record<string, any>, method: string | symbol | number): Promise<boolean> {
        console.log('beforeAction', subject, method, this.getInternalProperty('uniqueObjectId'))
        return true
    }
}
