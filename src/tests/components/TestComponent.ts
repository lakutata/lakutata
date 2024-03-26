import {Component} from '../../lib/core/Component.js'
import {Time} from '../../lib/core/Time.js'
import {Inject} from '../../decorators/di/Inject.js'
import type {Logger} from '../../components/Logger.js'

export class TestComponent extends Component {

    @Inject()
    protected readonly log: Logger

    protected async init(): Promise<void> {
        setInterval(() => this.emit('testComponentEvent', new Time().format()), 1000)
        this.log.info('TestComponent initialized')
    }
}
