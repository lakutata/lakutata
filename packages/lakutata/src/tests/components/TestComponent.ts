import {Component} from '@lakutata/core'
import {Time} from '@lakutata/core'
import {Inject} from '@lakutata/core'
import type {Logger} from '@lakutata/core'

export class TestComponent extends Component {

    @Inject()
    protected readonly log: Logger

    protected async init(): Promise<void> {
        // setInterval(() => this.emit('testComponentEvent', new Time().format()), 1000)
        this.log.info('TestComponent initialized')
    }
}
