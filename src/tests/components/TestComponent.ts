import {Component} from '../../lib/core/Component.js'
import {Time} from '../../lib/Time.js'
import {Application} from '../../lib/core/Application.js'
import {Inject} from '../../decorators/di/Inject.js'

export class TestComponent extends Component {

    @Inject()
    protected readonly app:Application

    protected async init(): Promise<void> {
        setInterval(() => this.emit('testComponentEvent',new Time().format()), 1000)
        console.log('TestComponent initialized')
    }
}
