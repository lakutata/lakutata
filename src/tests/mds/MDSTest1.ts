import {BaseObject} from '../../lib/base/BaseObject.js'
import {Configurable, Inject} from '../../decorators/DependencyInjectionDecorators.js'

export class MDSTest1 extends BaseObject {
    @Inject()
    protected readonly ob: any

    @Configurable()
    protected readonly tester: string

    protected async init(): Promise<void> {
        console.log('mmmmmmm', await this.ob.testRun(), this.tester)
    }

    protected async destroy(): Promise<void> {
        console.log('destroy!!!!')
    }
}
