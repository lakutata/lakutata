import {TestProvider} from './TestProvider.js'

export class TestProvider3 extends TestProvider {
    protected async init(): Promise<void> {
        console.log('TestProvider3Init', this.path)
        console.log('this.testProvider2.hello()', this.testProvider2.hello())
    }
}