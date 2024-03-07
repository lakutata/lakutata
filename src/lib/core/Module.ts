import {Component} from './Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {__destroy, __init, BaseObject} from '../base/BaseObject.js'
import {Container} from './Container.js'
import {GetObjectContainer} from '../base/internal/ObjectContainer.js'
import {BootstrapAsyncFunction, ModuleOptions} from '../../options/ModuleOptions.js'
import {ModuleConfigLoader} from '../base/internal/ModuleConfigLoader.js'
import {isAsyncFunction} from 'node:util/types'
import {As} from '../base/func/As.js'
import {Configurable} from '../../decorators/di/Configurable.js'

const MODULE_INIT_END_SIGNAL: symbol = Symbol('MODULE_INIT_END')

/**
 * Module base class
 */
@Singleton(true)
export class Module extends Component {

    /**
     * Module embed options
     * @protected
     */
    @Configurable(ModuleOptions.optional().default({}).options({stripUnknown: false}), function (this: Module, options: ModuleOptions) {
        console.log('oh', options, this.options,this.#bootstrap)
        // this.configLoader = new ModuleConfigLoader(this.options)
        return options
    })
    protected options: ModuleOptions = {
        /**
         * write options here
         */
        gggg:1
    }

    /**
     * Get container
     * @protected
     */
    protected get container(): Container {
        return GetObjectContainer(this)
    }

    /**
     * Config loader
     * @protected
     */
    protected configLoader: ModuleConfigLoader = new ModuleConfigLoader(this.options)

    /**
     * Constructor
     * @param cradleProxy
     */
    constructor(cradleProxy: Record<string | symbol, any>) {
        super(cradleProxy)
    }

    /**
     * Internal initializer
     * @param hooks
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Use setImmediate here for init module instance first, then sub objects can use @Inject decorator get current module
        setImmediate(async (): Promise<void> => {
            await super[__init](...hooks, async (): Promise<void> => {
                await this.#bootstrap()
            })
            this.emit(MODULE_INIT_END_SIGNAL)
        })
    }

    /**
     * Bootstrap
     * @private
     */
    async #bootstrap(): Promise<void> {
        for (const bootstrapOption of this.configLoader.bootstrap) {
            if (isAsyncFunction(bootstrapOption)) {
                await As<BootstrapAsyncFunction<this, void>>(bootstrapOption)(this)
            } else {
                await this.getObject(As(bootstrapOption))
            }
        }
    }

    /**
     * Register object (extends BaseObject)
     * @protected
     */
    protected async registerObject() {
        //TODO

    }

    /**
     * Register module
     * @protected
     */
    protected async registerModule() {
        //TODO
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
        await new Promise<void>((resolve, reject): void => {
            this.once(MODULE_INIT_END_SIGNAL, () => resolve())
            super.reload().catch(reject)
        })
    }
}
