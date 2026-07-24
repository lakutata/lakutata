import {Provider} from '@lakutata/core'

export class TestProvider2 extends Provider {
    public async hello() {
        return 'hi!!!'
    }
}