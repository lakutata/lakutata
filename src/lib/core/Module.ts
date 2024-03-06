import {Component} from './Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {__destroy, __init} from '../base/BaseObject.js'
import {Container} from './Container.js'
import {GetObjectContainer} from '../base/internal/ObjectContainer.js'

/**
 * Module base class
 */
@Singleton(true)
export class Module extends Component {

    /**
     * Get container
     * @protected
     */
    protected get container(): Container {
        return GetObjectContainer(this)
    }

    /**
     * Internal initializer
     * @param hooks
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Use setImmediate here for init module instance first, then sub objects can use @Inject decorator get current module
        setImmediate(async (): Promise<void> => super[__init](...hooks, async (): Promise<void> => {
            await this.bootstrap()
        }))
    }

    /**
     * Internal destroyer
     * @param hooks
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        return await super[__destroy](...hooks)
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        //TODO
        await this.bootstrap()
    }

    protected async bootstrap(): Promise<void> {
        //TODO
        console.log('bootstrap')
    }

    /**
     * Get current runtime env is production or development
     */
    public mode(): 'development' | 'production' {
        if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development'
        switch (process.env.NODE_ENV.toLowerCase()) {
            case 'production':
                return 'production'
            case 'development':
                return 'development'
            default: {
                process.env.NODE_ENV = 'development'
                return 'development'
            }
        }
    }

    /**
     * Reload self
     */
    public async reload(): Promise<void> {
        await super.reload()
        //TODO 还需要执行bootstrap
    }
}
