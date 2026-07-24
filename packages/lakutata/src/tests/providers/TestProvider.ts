import {Provider} from '@lakutata/core'
import {Transient} from '@lakutata/core'
import {Configurable} from '@lakutata/core'
import {TestProvider2} from './TestProvider2.js'
import {Inject} from '@lakutata/core'

@Transient()
export class TestProvider extends Provider {

    @Inject('testProvider2')
    protected readonly testProvider2: TestProvider2

    @Configurable()
    protected readonly path: string

    protected arr: any[] = []

    protected async init(): Promise<void> {
        this.arr = new Array(1024 * 1024).fill(255)
        console.log('TestProviderInit', this.path)
        console.log('this.testProvider2.hello()', this.testProvider2.hello())
    }

    public async testFunction() {

    }
}
