import {Provider} from '../../lib/core/Provider.js'

export class TestProvider2 extends Provider {
    public async hello() {
        return 'hi!!!'
    }
}