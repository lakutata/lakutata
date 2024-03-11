import {Component} from '../../lib/core/Component.js'
import {Time} from '../../lib/Time.js'

export class TestComponent extends Component {
    protected async init(): Promise<void> {
        setInterval(() => this.emit('testComponentEvent',new Time().format()), 1000)
        console.log('TestComponent initialized')
    }
}
