import {Application, Interval} from '../../exports/Core'
import {TestComponent} from '../components/TestComponent'
import {Inject} from '../../decorators/DependencyInjectionDecorators'
import {TestObject} from '../objects/TestObject'
import {DI_CONTAINER_INJECT_IS_MODULE_GETTER} from '../../constants/MetadataKey'

export class TestInterval extends Interval {

    @Inject(Application)
    protected readonly app: Application

    @Inject()
    protected readonly testComponent: TestComponent

    @Inject()
    protected readonly testObject: TestObject

    protected executor(): Promise<void> | void {
        console.log(this.className, 'got username:', this.testObject.getUsername())
    }
}
