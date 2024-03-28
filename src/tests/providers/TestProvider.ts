import {Provider} from '../../lib/core/Provider.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {Configurable} from '../../decorators/di/Configurable.js'

@Transient()
export class TestProvider extends Provider {

    @Configurable()
    protected readonly path: string

    protected arr: any[] = []

    protected async init(): Promise<void> {
        this.arr = new Array(1024 * 1024).fill(255)
        console.log('TestProviderInit',this.path)
    }

    public async testFunction() {

    }
}
