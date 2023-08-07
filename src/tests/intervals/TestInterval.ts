import {Application, Interval} from '../../Core.js'
import {TestComponent} from '../components/TestComponent.js'
import {Inject} from '../../decorators/DependencyInjectionDecorators.js'
import {TestObject} from '../objects/TestObject.js'
import {DI_CONTAINER_INJECT_IS_MODULE_GETTER} from '../../constants/MetadataKey.js'

export class TestInterval extends Interval {

    @Inject(Application)
    protected readonly app: Application

    @Inject()
    protected readonly testComponent: TestComponent

    @Inject()
    protected readonly testObject: TestObject

    protected executor(): Promise<void> | void {
        console.log(this.className, 'got username:', this.testObject.getUsername(),this.app)
    }
}
