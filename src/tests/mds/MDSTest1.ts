import {BaseObject} from '../../lib/base/BaseObject.js'
import {Configurable, Inject, Lifetime} from '../../decorators/DependencyInjectionDecorators.js'

@Lifetime('SINGLETON')
export class MDSTest1 extends BaseObject {

    @Configurable()
    protected readonly tester: string

    protected async init(): Promise<void> {
        // console.log('mmmmmmm', await this.ob.testRun(), this.tester)
    }

    protected async destroy(): Promise<void> {
        console.log('destroy!!!!')
    }
}
