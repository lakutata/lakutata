import {Provider} from '../../lib/core/Provider.js'
import {Transient} from '../../decorators/di/Lifetime.js'

@Transient()
export class TestProvider extends Provider {

    protected arr: any[] = []

    protected async init(): Promise<void> {
        this.arr = new Array(1024 * 1024).fill(255)
        console.log('TestProviderInit')
    }

    public async testFunction() {

    }
}
