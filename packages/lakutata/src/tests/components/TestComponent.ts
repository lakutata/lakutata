import {Component} from '@lakutata/core'
import {Time} from '@lakutata/utils/time'
import {Inject} from '@lakutata/core/decorator/di'
import type {Logger} from '@lakutata/logger'

export class TestComponent extends Component {

    @Inject()
    protected readonly log: Logger

    protected async init(): Promise<void> {
        // setInterval(() => this.emit('testComponentEvent', new Time().format()), 1000)
        this.log.info('TestComponent initialized')
    }
}
