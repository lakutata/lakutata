import {BaseObject} from '../../lib/base/BaseObject'
import {Configurable, Inject, Lifetime} from '../../decorators/DependencyInjectionDecorators'
import {IndexSignature} from '../../decorators/ValidationDecorators'

@Lifetime('SCOPED')
export class MDSTest1 extends BaseObject {

    @Configurable()
    protected readonly tester: string

    protected async init(): Promise<void> {
        console.log('mmmmmmmmmmmmmmmmmmmmmm', this.className)
    }

    protected async destroy(): Promise<void> {
        console.log('destroy!!!!')
    }
}
