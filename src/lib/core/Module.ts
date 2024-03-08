import {Component} from './Component.js'
import {Scoped, Singleton} from '../../decorators/di/Lifetime.js'
import {__destroy, __init, BaseObject} from '../base/BaseObject.js'
import {Container} from './Container.js'
import {GetObjectContainer} from '../base/internal/ObjectContainer.js'
import {BootstrapAsyncFunction, BootstrapOption, ModuleOptions} from '../../options/ModuleOptions.js'
import {ModuleConfigLoader} from '../base/internal/ModuleConfigLoader.js'
import {isAsyncFunction} from 'node:util/types'
import {As} from '../base/functions/As.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {LoadObjectOptions} from '../../options/LoadObjectOptions.js'

const MODULE_INIT_END_SIGNAL: symbol = Symbol('MODULE_INIT_END')

/**
 * Module base class
 */
@Singleton(true)
export class Module extends Component {

    /**
     * Config loader constructor
     * @protected
     */
    protected readonly ConfigLoader: typeof ModuleConfigLoader = ModuleConfigLoader

    /**
     * Module embed options
     * @protected
     */
    @Configurable(ModuleOptions.optional().default({}).options({stripUnknown: false}), function (this: Module, options: ModuleOptions) {
        const {bootstrap, loadOptions} = new this.ConfigLoader(this.options)
        bootstrap.forEach(value => this.#bootstrap.push(value))
        const result = new this.ConfigLoader(options, loadOptions)
        result.bootstrap.forEach(value => this.#bootstrap.push(value))
        this.#objects = result.loadOptions
        return options
    })
    protected options: ModuleOptions = {
        /**
         * write options here
         */
    }

    /**
     * Get container
     * @protected
     */
    protected get container(): Container {
        return GetObjectContainer(this)
    }

    /**
     * Objects to be loaded
     * @private
     */
    #objects: (LoadObjectOptions | typeof BaseObject | string)[] = []

    /**
     * Bootstrap
     * @private
     */
    #bootstrap: BootstrapOption<typeof BaseObject, this>[] = []

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
            await super[__init](...hooks,
                async (): Promise<void> => {
                    //Load objects stage
                    await this.container.load(this.#objects)
                },
                async (): Promise<void> => {
                    //Bootstrap stage
                    for (const bootstrapOption of this.#bootstrap) {
                        if (isAsyncFunction(bootstrapOption)) {
                            await As<BootstrapAsyncFunction<this, void>>(bootstrapOption)(this)
                        } else {
                            await this.getObject(As(bootstrapOption))
                        }
                    }
                })
            this.emit(MODULE_INIT_END_SIGNAL)
        })
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
