import {Component} from './Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {__destroy, __init, __revive, type BaseObject} from '../base/BaseObject.js'
import {Container} from './Container.js'
import {GetObjectContainer} from '../base/internal/ObjectContainer.js'
import {BootstrapAsyncFunction, BootstrapOption, ModuleOptions} from '../../options/ModuleOptions.js'
import {ModuleConfigLoader} from '../base/internal/ModuleConfigLoader.js'
import {isAsyncFunction} from 'node:util/types'
import {Configurable} from '../../decorators/di/Configurable.js'
import {LoadObjectOptions} from '../../options/LoadObjectOptions.js'
import {As} from '@lakutata/utils/As'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {DefineObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {nonceString} from '@lakutata/utils/NonceString'
import {CheckObjectOptions} from '../base/internal/ObjectOptionsCheck.js'
import {CurrentMode} from '../foundation/BasicInfo.js'
import {MODULE_INITIALIZATION} from '../base/internal/ModuleInitialization.js'

export const MODULE_INITIALIZED: string = `_$.MODULE.INITIALIZED_${nonceString()}`
export const MODULE_INITIALIZE_ERROR: string = `_$.MODULE.INITIALIZE_ERROR_${nonceString()}`

/**
 * The initialization of a module and its settlement
 */
type ModuleInitialization = {
    promise: Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
}

/**
 * The base class of the modules: a component owning its own objects (components, providers, named and anonymous
 * objects) declared by its options, the way the application declares its own. Its lifetime is `@Singleton`, locked.
 * The objects of a module resolve their dependencies from the module first, then from the application; the objects
 * of the application do not see the module's.
 *
 * Declare it in the `objects.named` of the application (or of a parent module) options, its options under `options`
 * (they are merged over its `options` initializer), and list it in `bootstrap` to start it at launch. When a module is
 * created, its options are checked (see `checkOptions`), its objects registered, then its `bootstrap` runs in order: a
 * name or class is got from its container (creating it), an async function is called with the module. An object
 * outside the module getting it (`getObject`, `@Inject`) receives it once these steps are complete, and receives the
 * error of a step that fails; the module's own objects, created by these steps, receive it at once (they can inject
 * the module they belong to).
 * @example
 * ```typescript
 * import {Application, Component, Module, type ModuleOptions} from 'lakutata'
 *
 * class Billing extends Component {
 *     public charge(amount: number): void {
 *         console.log(`Charged ${amount}`)
 *     }
 * }
 *
 * export class PaymentModule extends Module {
 *     protected options: ModuleOptions = {
 *         components: {
 *             billing: {class: Billing}
 *         },
 *         bootstrap: ['billing']
 *     }
 * }
 *
 * Application.run({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     objects: {
 *         named: {
 *             payment: {class: PaymentModule}
 *         }
 *     },
 *     bootstrap: ['payment']
 * })
 * ```
 */
@Singleton(true)
@DefineObjectType(ObjectType.Module)
export class Module extends Component {

    /**
     * The class reading the module options into the declarations to register and the bootstrap steps (the
     * application's reads its identity too).
     * @protected
     */
    protected readonly ConfigLoader: typeof ModuleConfigLoader = ModuleConfigLoader

    /**
     * The module's own declarations, given by the initializer of a subclass; the options configured for the module
     * (its `options` option) are merged over them: a component, provider or named object of the same name is
     * replaced, or completed when declared without its class, and the bootstrap steps are appended.
     * @protected
     */
    @Configurable(ModuleOptions.optional().default({}).options({stripUnknown: false}), function (this: Module, options: ModuleOptions) {
        //The options of the module (its initializer) with the options configured over them: without configuration, the
        //value is the initializer, which is not merged twice
        const configured: ModuleOptions = this.getConfigurableRecords().options !== undefined ? options : {}
        const {bootstrap, loadOptions} = new this.ConfigLoader(this, this.options)
        bootstrap.forEach(value => this.#bootstrap.push(value))
        const result = new this.ConfigLoader(this, configured, loadOptions)
        result.bootstrap.forEach(value => this.#bootstrap.push(value))
        this.#objects = result.loadOptions
        this.#checkOptions = (configured.checkOptions ?? this.options.checkOptions) !== false
        return options
    })
    protected options: ModuleOptions = {
        /**
         * write options here
         */
    }

    /**
     * The module's container, holding the objects it declares.
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
     * Whether the options of the objects are checked before they are loaded
     * @private
     */
    #checkOptions: boolean = true

    /**
     * Called by the container only: a module is created through a container, never with `new`.
     * @param cradleProxy The container's resolution proxy.
     */
    constructor(cradleProxy: Record<string | symbol, any>) {
        super(cradleProxy)
    }

    /**
     * The framework's initializer: schedules the initialization (injection, configured values, `init()`, the objects
     * registered, the bootstrap) for a later turn of the event loop and returns at once; the completion or the failure
     * is emitted as an internal event. Override `init()` instead.
     * @param hooks The steps the framework's subclasses run before the objects are registered.
     * @returns Resolves at once, before the initialization.
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Use setImmediate here for init module instance first, then sub objects can use @Inject decorator get current module
        //The initialization reports its errors (MODULE_INITIALIZE_ERROR)
        //The initialization in progress, waited for by the objects resolving the module from outside it
        const initialization: ModuleInitialization = {} as ModuleInitialization
        initialization.promise = new Promise<void>((resolve: () => void, reject: (error: unknown) => void): void => {
            initialization.resolve = resolve
            initialization.reject = reject
        })
        //Its failure is reported by the event, the waiters receive it
        initialization.promise.catch((): undefined => undefined)
        this.#initialization = initialization
        setImmediate((): void => void (async (): Promise<void> => {
            try {
                await super[__init](
                    ...hooks,
                    async (): Promise<void> => {
                        //Load objects stage
                        if (this.#checkOptions) CheckObjectOptions(this.#objects)
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
                initialization.resolve()
            } catch (e) {
                this.emit(MODULE_INITIALIZE_ERROR, e)
                initialization.reject(e)
            }
        })())
    }

    /**
     * The initialization of the module in progress or done (none before it starts), see {@link MODULE_INITIALIZATION}
     * @internal
     */
    #initialization: ModuleInitialization | undefined

    /**
     * Wait for the initialization of the module: its objects loaded and its bootstrap run
     * @returns Resolves once it is initialized (at once when its initialization did not start), rejects with the error
     * of its initialization
     * @internal
     */
    public async [MODULE_INITIALIZATION](): Promise<void> {
        await this.#initialization?.promise
    }

    /**
     * The framework's destroyer, see {@link Component}; override `beforeDestroy()` and `destroy()` instead.
     * @param hooks The steps the framework's subclasses run before `destroy()`.
     * @returns Resolves once the module and its objects are destroyed.
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Destroyed before its initialization ran (it never runs then): its waiters are released
        this.#initialization?.resolve()
        return await super[__destroy](...hooks)
    }

    /**
     * The mode the application runs in: the `MODE` environment variable, else `NODE_ENV`, when it is `development` or
     * `production`; `development` otherwise.
     * @returns The mode.
     */
    public mode(): 'development' | 'production' {
        return CurrentMode()
    }

    /**
     * Destroy the module with its objects and initialize it again (same instance): its objects are registered again
     * and its bootstrap runs again.
     * @returns Resolves once the module is initialized again.
     * @throws {ObjectDestroyedException} When its parent has been destroyed.
     * @throws {Error} The error of its teardown or of its initialization.
     */
    public async reload(): Promise<void> {
        await this[__destroy]()
        this[__revive]()
        //Listen after the teardown, which removes all event listeners of the module
        await new Promise<void>((resolve, reject): void => {
            const onInitialized = (): void => {
                this.off(MODULE_INITIALIZE_ERROR, onInitializeError)
                resolve()
            }
            const onInitializeError = (error: Error): void => {
                this.off(MODULE_INITIALIZED, onInitialized)
                reject(error)
            }
            this.once(MODULE_INITIALIZED, onInitialized)
            this.once(MODULE_INITIALIZE_ERROR, onInitializeError)
            this[__init]().catch(reject)
        })
    }

    /**
     * Get an object registered by its class, from the module's container or its parents, as {@link Container.get}.
     * @param constructor The class the object was registered with (or an `@Autoload` class).
     * @param configurableRecords The options of the object, merged over the ones it was declared with. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists; a scoped object
     * requested with options is a new instance owned by the module.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the module has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     */
    public async getObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name (its key in the module options), as {@link Module.getObject} by class.
     * @param name The registration name.
     * @param configurableRecords The options of the object, merged over the ones it was declared with. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists; a scoped object
     * requested with options is a new instance owned by the module.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the module has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     */
    public async getObject<T extends BaseObject>(name: string, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a symbol, as {@link Module.getObject} by class.
     * @param name The registration symbol.
     * @param configurableRecords The options of the object, merged over the ones it was declared with. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists; a scoped object
     * requested with options is a new instance owned by the module.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the module has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     */
    public async getObject<T extends BaseObject>(name: symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name or a symbol, as {@link Module.getObject} by class.
     * @param name The registration name or symbol.
     * @param configurableRecords The options of the object, merged over the ones it was declared with. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists; a scoped object
     * requested with options is a new instance owned by the module.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the module has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     */
    public async getObject<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name, a symbol or by its class, as {@link Module.getObject} by class.
     * @param nameOrConstructor The registration name, symbol or class.
     * @param configurableRecords The options of the object, merged over the ones it was declared with. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists; a scoped object
     * requested with options is a new instance owned by the module.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the module has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     */
    public async getObject<T extends BaseObject>(nameOrConstructor: string | symbol | IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    public async getObject<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return await super.getObject(inp, configurableRecords)
    }
}
