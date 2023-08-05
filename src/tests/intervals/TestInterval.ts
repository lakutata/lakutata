import {Interval} from '../../Core.js'
import {TestComponent} from '../components/TestComponent.js'
import {Inject} from '../../decorators/DependencyInjectionDecorators.js'
import {TestObject} from '../objects/TestObject.js'

export class TestInterval extends Interval {

    @Inject()
    protected readonly testComponent: TestComponent

    @Inject()
    protected readonly testObject: TestObject

    protected executor(): Promise<void> | void {
        console.log(this.className, 'got username:', this.testObject.getUsername())
    }
}
