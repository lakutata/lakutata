import {Component} from './Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {__destroy, __init} from '../base/BaseObject.js'

/**
 * Module base class
 */
@Singleton(true)
export class Module extends Component {

    constructor(cradleProxy: Record<string | symbol, any>) {
        super(Object.create(null))
    }

    /**
     * Internal init handler
     * @protected
     */
    protected async [__init](): Promise<void> {
        //TODO
        await super[__init]()
    }

    /**
     * Internal destroy handler
     * @protected
     */
    protected async [__destroy](): Promise<void> {
        //TODO
        await super[__destroy]()
    }

    /**
     * Reload module
     */
    public async reload(): Promise<void> {
        await this[__destroy]()
        await this[__init]()
    }
}
