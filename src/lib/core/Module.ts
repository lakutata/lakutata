import {Component} from './Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {__destroy, __init, type BaseObject} from '../base/BaseObject.js'
import {Container} from './Container.js'
import {GetObjectContainer} from '../base/internal/ObjectContainer.js'
import {BootstrapAsyncFunction, BootstrapOption, ModuleOptions} from '../../options/ModuleOptions.js'
import {ModuleConfigLoader} from '../base/internal/ModuleConfigLoader.js'
import {isAsyncFunction} from 'node:util/types'
import {Configurable} from '../../decorators/di/Configurable.js'
import {LoadObjectOptions} from '../../options/LoadObjectOptions.js'
import {As} from '../functions/As.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {NonceStr} from '../functions/NonceStr.js'

export const MODULE_INITIALIZED: string = `_$.MODULE.INITIALIZED_${NonceStr()}`
export const MODULE_INITIALIZE_ERROR: string = `_$.MODULE.INITIALIZE_ERROR_${NonceStr()}`

/**
 * Module base class
 */
@Singleton(true)
@DefineObjectType(ObjectType.Module)
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
        const {bootstrap, loadOptions} = new this.ConfigLoader(this, this.options)
        bootstrap.forEach(value => this.#bootstrap.push(value))
        const result = new this.ConfigLoader(this, options, loadOptions)
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
    #bootstrap: BootstrapOption[] = []

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
            try {
                await super[__init](
                    ...hooks,
                    async (): Promise<void> => {
                        //Load objects stage
                        await this.container.load(this.#objects)
                    },
                    async (): Promise<void> => {
                        Reflect.defineMetadata('#bootstrap', this.#bootstrap, this)
                        //Bootstrap stage
                        for (const bootstrapOption of this.#bootstrap) {
                            if (isAsyncFunction(bootstrapOption)) {
                                await As<BootstrapAsyncFunction<this, void>>(bootstrapOption)(this)
                            } else {
                                await this.getObject(As(bootstrapOption))
                            }
                        }
                        Reflect.deleteMetadata('#bootstrap', this)
                    }
                )
                this.emit(MODULE_INITIALIZED)
            } catch (e) {
                this.emit(MODULE_INITIALIZE_ERROR, e)
            }
        })
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
            this.once(MODULE_INITIALIZED, () => resolve())
            super.reload().catch(reject)
        })
    }

    /**
     * Get registered object via constructor
     * @param constructor
     * @param configurableRecords
     */
    public async getObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string
     * @param name
     * @param configurableRecords
     */
    public async getObject<T extends BaseObject>(name: string, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via symbol
     * @param name
     * @param configurableRecords
     */
    public async getObject<T extends BaseObject>(name: symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string or symbol
     * @param name
     * @param configurableRecords
     * @protected
     */
    public async getObject<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string or symbol or constructor
     * @param nameOrConstructor
     * @param configurableRecords
     * @protected
     */
    public async getObject<T extends BaseObject>(nameOrConstructor: string | symbol | IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    public async getObject<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return await super.getObject(inp, configurableRecords)
    }
}
