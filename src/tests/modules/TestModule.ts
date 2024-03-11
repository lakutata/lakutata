import {Module} from '../../lib/core/Module.js'
import {Time} from '../../lib/Time.js'

export class TestModule extends Module {
    protected async init(): Promise<void> {
        setInterval(() => this.emit('testModuleEvent', new Time().format()), 1000)
        console.log('TestModule initialized')
    }
}
