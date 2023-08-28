import {Controller} from '../../lib/base/Controller'
import {Action} from '../../decorators/ControllerDecorators'
import {Configurable} from '../../decorators/DependencyInjectionDecorators'
import {Test2Controller} from './Test2Controller'
import {AccessControl} from '../../lib/access-control/AccessControl'

export class Test1Controller extends Controller {

    @Configurable()
    public testBoolean: boolean

    @Action({a: '*', b: '*'})
    public async test(inp) {
        console.log('FDFDFDFDFDFDFDF')
        return await this.test1(inp)
        // return this
    }

    // @AccessControl.CheckPermission()
    @Action({a: 2}, {name: '测试动作1', operation: 'read'})
    public async test1(inp) {
        console.log('this is test1 method, the inp is:', inp)
        return this.forward(Test2Controller, Object.assign(inp, {test2: true}))
    }

    @Action({a: 1, b: 3}, {name: '测试动作2', operation: 'read'})
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
