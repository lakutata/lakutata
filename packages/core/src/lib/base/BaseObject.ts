import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'
import {Container, containerSymbol, registerTeardownHook} from '../core/Container.js'
import {randomUUID} from 'node:crypto'
import {getConfigurableRecordsFromInstance, getIdFromInstance, getRegistrationNameFromInstance} from './internal/ConfigurableRecordsInjection.js'
import {getObjectConfigurableProperties} from './internal/ObjectConfiguration.js'
import {
    getObjectInjectItemsByPrototype,
    InjectionTransformFunction,
    type ObjectInjectionMap
} from './internal/ObjectInjection.js'
import {setObjectContainerGetter} from './internal/ObjectContainer.js'
import {DTO} from '../dto/DTO.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {isSymbol} from '@lakutata/utils/IsSymbol'
import {objectConstructor} from '@lakutata/utils/ObjectConstructor'
import {As} from '@lakutata/utils/As'
import {DevNull} from '@lakutata/utils/DevNull'
import {DefineObjectType, getObjectType, ObjectType, registerBaseObject} from './internal/ObjectType.js'
import {Module} from '../core/Module.js'
import {whenApplicationLaunched} from './internal/ApplicationLaunch.js'
import {runObjectStartup, waitForObjectStartup, waitForObjectStartupEnd} from './internal/ObjectStartup.js'
import {reportLaunchedError} from '../foundation/LifecycleErrorReporter.js'
import {DependencyInjectionException} from '../../exceptions/di/DependencyInjectionException.js'
import {ObjectDestroyedException} from '../../exceptions/ObjectDestroyedException.js'

/**
 * Internal init function symbol
 */
export const __init: unique symbol = Symbol('__init')

/**
 * Internal destroy function symbol
 */
export const __destroy: unique symbol = Symbol('__destroy')

/**
 * Symbol of the method that makes a destroyed object ready to be initialized again (reload)
 */
export const __revive: unique symbol = Symbol('__revive')

/**
 * Anonymous ID symbol, the default id value if object's id not defined in runtime
 */
export const anonymousId: symbol = Symbol('anonymous')

const OSP: symbol = Symbol('OBJECT.SYMBOL.PROPERTY')

/**
 * Object lifecycle state
 */
type ObjectState = 'constructing' | 'ready' | 'destroying' | 'destroyed'

/**
 * The base class of every object managed by the container (the {@link Provider}, {@link Component}, {@link Module} and
 * {@link Application} classes extend it). Extend it for a plain object; its lifetime is `@Transient`: a new instance
 * each time it is requested.
 *
 * An object is never created with `new`: the container creates it (`getObject()`, `buildObject()`, the module options),
 * asynchronously: its `@Inject` properties are resolved, its `@Configurable` properties get their configured values
 * (validated and transformed by their schemas; a property not configured keeps its initializer, else the default of
 * its schema), then its `init()` runs, then its `startup()` (the object is given to its requesters once started, except
 * to the call chain of its startup). Once its application has launched, its `launched()` runs. At its teardown
 * (`dispose()`, or the teardown of the object, scope or application which created it) its `beforeDestroy()` runs, then
 * the objects it created are destroyed, then its `destroy()` runs. Each object owns a container: the objects it
 * creates are destroyed with it.
 * @example
 * ```typescript
 * import {BaseObject, Container, DTO} from 'lakutata'
 * import {Configurable} from 'lakutata/decorator/di'
 *
 * class Counter extends BaseObject {
 *     @Configurable(DTO.Number().integer().min(0))
 *     protected readonly start: number = 0
 *
 *     #value: number = 0
 *
 *     protected async init(): Promise<void> {
 *         this.#value = this.start
 *     }
 *
 *     public increment(): number {
 *         return ++this.#value
 *     }
 * }
 *
 * const container: Container = new Container()
 * const counter: Counter = await container.build(Counter, {start: 10})
 * console.log(counter.increment()) //11
 * await counter.dispose()
 * ```
 */
@Transient()
@DefineObjectType(ObjectType.Object)
export class BaseObject extends AsyncConstructor {

    readonly #container: Container

    #objectId: string | symbol

    #uniqueId: string = randomUUID()

    #injectionApplied: boolean = false

    #configurableRecordsLoaded: boolean = false

    #state: ObjectState = 'constructing'

    #destroying: Promise<void> | undefined

    #beforeDestroying: Promise<void> | undefined

    #launchedToken: number = 0

    /**
     * Throw if current object has been destroyed
     * @private
     */
    #assertNotDestroyed(): void {
        if (this.#state === 'destroying' || this.#state === 'destroyed') throw new ObjectDestroyedException('Object "{className}" has been destroyed', {className: this.className})
    }

    /**
     * Load configurable records: the value of a configurable property is the value configured, else the initializer of
     * the property (its value once constructed), else the default of its schema; validated and transformed
     * @private
     */
    async #loadConfigurableRecords(): Promise<void> {
        const configurableRecords: Record<string, any> = getConfigurableRecordsFromInstance(this)
        const setConfigurableValuePromises: Promise<void>[] = []
        getObjectConfigurableProperties(this).forEach((schemaAndFn, propertyKey): void => {
            if (isSymbol(propertyKey)) return
            const configured: unknown = configurableRecords[As<string>(propertyKey)]
            const value: unknown = configured !== undefined ? configured : this[propertyKey]
            setConfigurableValuePromises.push(new Promise<void>((resolve, reject): void => {
                DTO.validateAsync(value, schemaAndFn.schema, {targetName: propertyKey}).then(validatedValue => {
                    return Promise.resolve(schemaAndFn.fn.bind(this)(validatedValue)).then(propertyValue => {
                        this[propertyKey] = propertyValue
                        return resolve()
                    }).catch(reject)
                }).catch(reject)
            }))
        })
        await Promise.all(setConfigurableValuePromises)
    }

    /**
     * Apply object injection
     * @private
     */
    async #applyInjection(): Promise<void> {
        const objectInjectionMap: ObjectInjectionMap = getObjectInjectItemsByPrototype(this)
        const injectionPromises: Promise<void>[] = []
        objectInjectionMap.forEach((info: {
            name: string | symbol | Function
            transform: InjectionTransformFunction
        }, propertyKey: string | symbol): void => {
            const registration: string | symbol | IBaseObjectConstructor = As<string | symbol | IBaseObjectConstructor>(info.name)
            injectionPromises.push(new Promise((resolve, reject): void => {
                //Get injection value
                this.#container.get(registration).then(injectObject => {
                    //Apply transform function to injection value
                    Promise.resolve(info.transform(injectObject)).then(transformedInjectObject => {
                        //Set transformed injection value to property
                        Reflect.set(this, propertyKey, transformedInjectObject)
                        return resolve()
                    }).catch(reject)
                }).catch(injectionError =>
                    reject(new DependencyInjectionException('Unable to inject value for property {0} of {1} because: {2}', [
                        propertyKey,
                        this.className,
                        injectionError.message
                    ]))
                )
            }))
        })
        await Promise.all(injectionPromises)
    }

    /**
     * Set object id
     * @private
     */
    #setObjectId(): void {
        const id: string | symbol | undefined = getIdFromInstance(this)
        this.#objectId = id ? id : anonymousId
    }

    /**
     * Called by the container only: an object is created through a container (see the class description), never with
     * `new`.
     * @param cradleProxy The container's resolution proxy.
     */
    constructor(cradleProxy: Record<string | symbol, any>) {
        super(async (): Promise<void> => {
            this.#setObjectId()
            //Ensure property "then" not in subclass
            const thenablePropertyDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(this, 'then')
            if (thenablePropertyDescriptor) Object.defineProperty(this, 'then', {enumerable: false})
            //Execute init functions
            await this[__init]()
        })
        this.#container = new Container(cradleProxy[containerSymbol], this)
        setObjectContainerGetter(this, this.#container)
        //The teardown of the container may start before the teardown of the object (the teardown of its owner destroys
        //the containers of the objects first), so beforeDestroy() runs when the teardown of the container starts
        if (this.beforeDestroy !== BaseObject.prototype.beforeDestroy) {
            registerTeardownHook(this.#container, (): Promise<void> => this.#beforeDestroying ? Promise.resolve() : this.#runBeforeDestroy())
        }
    }

    /**
     * Run beforeDestroy() once for a teardown
     * @private
     */
    #runBeforeDestroy(): Promise<void> {
        return this.#beforeDestroying ??= (async (): Promise<void> => {
            //An object stops once its startup ended
            const startupEnd: Promise<void> | undefined = waitForObjectStartupEnd(this)
            if (startupEnd) await startupEnd
            await this.beforeDestroy()
        })()
    }

    /**
     * The name of the class.
     */
    public static get className(): string {
        return this.name
    }

    /**
     * Whether the class accepts an option which is not one of its `@Configurable` properties (an option it reads with
     * `getConfigurableRecords()`): the modules check the options of the objects they declare and warn of the options
     * the classes do not accept. Override it in the classes reading options without configurable properties.
     * @param name The option name.
     * @param value The option value.
     * @returns true when the option is accepted; false by default.
     */
    public static acceptsOption(name: string, value: unknown): boolean {
        DevNull(name, value)
        return false
    }

    /**
     * The name of the object's class.
     */
    public get className(): string {
        return objectConstructor(this).name
    }

    /**
     * The framework's initializer: injects the dependencies, applies the configured values, runs the hooks, then
     * `init()`. Override `init()` instead.
     * @param hooks The steps the framework's subclasses run before `init()`.
     * @returns Resolves once the object is ready.
     * @throws {ObjectDestroyedException} When the object has been destroyed (before or during its initialization).
     * @protected
     */
    protected async [__init](...hooks: (() => Promise<void>)[]): Promise<void> {
        //A destroyed object is only initialized again through an explicit reload (see __revive)
        this.#assertNotDestroyed()
        this.#container.registerContainerToItsParent()
        if (!this.#injectionApplied) {
            //Apply object injection
            await this.#applyInjection()
            this.#injectionApplied = true
        }
        if (!this.#configurableRecordsLoaded) {
            //Load and apply configurable records to current object's property
            await this.#loadConfigurableRecords()
            this.#configurableRecordsLoaded = true
        }
        //Execute hooks
        for (const hook of hooks) await hook()
        //Execute normal initializer
        await this.init()
        //A teardown which happened during the initialization wins, the object never becomes ready
        this.#assertNotDestroyed()
        this.#state = 'ready'
        //The startup runs once the object can be got, its requesters wait for it (see startup())
        if (this.startup !== BaseObject.prototype.startup) void runObjectStartup(this, (): Promise<void> => this.startup())
        if (this.launched !== BaseObject.prototype.launched) this.#scheduleLaunched()
    }

    /**
     * Call launched() once the application of the object has launched, or right after the initialization when it has
     * launched already or when there is no application; only for the last initialization of a ready object
     * @private
     */
    #scheduleLaunched(): void {
        const token: number = ++this.#launchedToken
        const run = (): void => {
            if (token !== this.#launchedToken || this.#state !== 'ready') return
            try {
                Promise.resolve(this.launched()).catch((error: unknown): void => reportLaunchedError(error, this.className))
            } catch (error) {
                reportLaunchedError(error, this.className)
            }
        }
        //Once started: an object whose startup failed is not called
        void (whenApplicationLaunched(this) ?? Promise.resolve()).then((): Promise<void> => waitForObjectStartup(this)).then(run, DevNull)
    }

    /**
     * Make a destroyed object ready to be initialized again (its reload); its dependencies, destroyed with it, are
     * injected again. Does nothing when the object is not destroyed.
     * @throws {ObjectDestroyedException} When the parent's container has been destroyed (or is being destroyed).
     * @protected
     */
    protected [__revive](): void {
        if (this.#state !== 'destroyed') return
        this.#container.revive()
        this.#destroying = undefined
        this.#beforeDestroying = undefined
        this.#injectionApplied = false
        this.#state = 'constructing'
    }

    /**
     * The framework's destroyer: `beforeDestroy()`, the objects created by this object, the hooks, then `destroy()`;
     * runs once whatever starts it. Override `beforeDestroy()` and `destroy()` instead.
     * @param hooks The steps the framework's subclasses run before `destroy()`.
     * @returns Resolves once the object is destroyed.
     * @throws {Error} The error of `beforeDestroy()`, a hook or `destroy()` (an `AggregateError` when several fail), to
     * the first caller only.
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Every teardown path (dispose, owner/scope teardown, asyncDispose) runs the same teardown only once,
        //its errors are delivered to the first caller only
        if (this.#destroying) return await this.#destroying.catch(DevNull)
        this.#state = 'destroying'
        this.#destroying = (async (): Promise<void> => {
            const errors: unknown[] = []
            //An object is destroyed once its startup ended (its startup itself destroying it does not wait)
            const startupEnd: Promise<void> | undefined = waitForObjectStartupEnd(this)
            if (startupEnd) await startupEnd
            //The object stops its work while the objects it created are still alive (unless the teardown of its
            //container already did it, then its errors were reported)
            if (this.#beforeDestroying) {
                await this.#beforeDestroying.catch(DevNull)
            } else {
                try {
                    await this.#runBeforeDestroy()
                } catch (e) {
                    errors.push(e)
                }
            }
            //Destroy internal container, objects created by current object are destroyed first (errors are reported by container)
            await this.#container.destroy()
            //Execute hooks
            for (const hook of hooks) {
                try {
                    await hook()
                } catch (e) {
                    errors.push(e)
                }
            }
            //Execute normal destroyer
            try {
                await this.destroy()
            } catch (e) {
                errors.push(e)
            }
            this.#state = 'destroyed'
            if (errors.length === 1) throw errors[0]
            if (errors.length > 1) throw new AggregateError(errors, `Failed to destroy object "${this.className}"`)
        })()
        return await this.#destroying
    }

    /**
     * Initialize the object, once its dependencies are injected and its configured values applied; override it. The
     * object is returned to its requester once it completes; an error thrown here fails the object's creation.
     * @returns Resolves once initialized.
     * @protected
     */
    protected async init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Start the object's work once it is initialized and can be got by the other objects (listen on a port, start the
     * adapters of an entrypoint); override it. The objects getting it (`getObject()`, `@Inject`, a bootstrap step, the
     * container's `get()` and `set()`) wait until it completes, and fail with its error; but the objects got from
     * within it, directly or through the objects they create, get the object at once (initialized, not started yet),
     * so an object it gets may inject it. Its `launched()` runs once it completed (not when it failed); its teardown
     * waits for it to end. A module's runs once its bootstrap ran (the application's, once it launched). The name of
     * the hook is `startup` so that the classes having a `start()` method of their own (a container of Docker) are not
     * started by the framework.
     * @returns Resolves once the object started.
     * @protected
     * @example
     * ```typescript
     * import {createServer, type Server} from 'node:http'
     * import {Component} from 'lakutata'
     *
     * export class StatusServer extends Component {
     *     #server: Server = createServer((_request, response): void => void response.end('ok'))
     *
     *     //The objects getting the server get it listening; a port in use fails them
     *     protected async startup(): Promise<void> {
     *         await new Promise<void>((resolve, reject): void => {
     *             this.#server.once('error', reject).listen(8080, resolve)
     *         })
     *     }
     *
     *     protected async destroy(): Promise<void> {
     *         await new Promise((resolve): unknown => this.#server.close(resolve))
     *     }
     * }
     * ```
     */
    protected async startup(): Promise<void> {
        //To be override in child class
    }

    /**
     * Called once the object's application has launched (its objects are created and its bootstrap ran), as the
     * mounted hook of a Vue component: the object starts the work which needs the whole application; override it. An
     * object created once the application has launched, or without application (in a bare container), is called right
     * after its initialization; an object destroyed before is not called, a reloaded object is called again. Its errors
     * are reported through the application's logger, they do not stop the application.
     * @returns Resolves once the work is started; not awaited by the application.
     * @protected
     */
    protected async launched(): Promise<void> {
    }

    /**
     * Called when the object's teardown starts, before the objects it created are destroyed (as the parent-first
     * beforeDestroy of a Vue component): the object stops its work, such as receiving requests, while the objects it
     * uses are still alive; override it. Called once per teardown, whatever starts it.
     * @returns Resolves once the work is stopped.
     * @protected
     */
    protected async beforeDestroy(): Promise<void> {
    }

    /**
     * Release the object's resources (connections, timers…), called once the objects it created are destroyed;
     * override it. Its error is thrown to the caller of `dispose()`, or reported when a parent's teardown destroys it.
     * @returns Resolves once released.
     * @protected
     */
    protected async destroy(): Promise<void> {
        //To be override in child class
    }

    /**
     * Get an object registered by its class, from this object's container or its parents (the module's registrations,
     * the application's), as {@link Container.get}. The objects it creates are destroyed with this object.
     * @param constructor The class the object was registered with (or an `@Autoload` class).
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with. Ignored, with a warning outside production, when the
     * cached singleton or scoped instance already exists; a scoped object requested with options is a new instance
     * owned by this object.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When this object has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     * @protected
     */
    protected async getObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name (its key in the module options), as {@link BaseObject.getObject} by class.
     * @param name The registration name.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with. Ignored, with a warning outside production, when the
     * cached singleton or scoped instance already exists; a scoped object requested with options is a new instance
     * owned by this object.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When this object has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     * @protected
     */
    protected async getObject<T extends BaseObject>(name: string, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a symbol, as {@link BaseObject.getObject} by class.
     * @param name The registration symbol.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with. Ignored, with a warning outside production, when the
     * cached singleton or scoped instance already exists; a scoped object requested with options is a new instance
     * owned by this object.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When this object has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     * @protected
     */
    protected async getObject<T extends BaseObject>(name: symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name or a symbol, as {@link BaseObject.getObject} by class.
     * @param name The registration name or symbol.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with. Ignored, with a warning outside production, when the
     * cached singleton or scoped instance already exists; a scoped object requested with options is a new instance
     * owned by this object.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When this object has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     * @protected
     */
    protected async getObject<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name, a symbol or by its class, as {@link BaseObject.getObject} by class.
     * @param nameOrConstructor The registration name, symbol or class.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with. Ignored, with a warning outside production, when the
     * cached singleton or scoped instance already exists; a scoped object requested with options is a new instance
     * owned by this object.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When this object has been destroyed.
     * @throws {Error} When nothing is registered under it, or the object fails to be created.
     * @protected
     */
    protected async getObject<T extends BaseObject>(nameOrConstructor: string | symbol | IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    protected async getObject<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        this.#assertNotDestroyed()
        return await this.#container.get(inp, configurableRecords)
    }

    /**
     * Create a new object of a class without registering it, whatever its lifetime, as {@link Container.build}; it is
     * destroyed with this object (unless disposed before).
     * @param constructor The class, registered or not.
     * @param configurableRecords The options of the object.
     * @returns The new object, once created and initialized.
     * @throws {ObjectDestroyedException} When this object has been destroyed.
     * @throws {Error} When the object fails to be created.
     * @protected
     */
    protected async buildObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        this.#assertNotDestroyed()
        return this.#container.build(constructor, configurableRecords)
    }

    /**
     * The options the object was created with, as they were given: the values of its configurable properties before
     * their validation, and the options which are not configurable properties.
     * @returns A copy of the options.
     * @protected
     */
    protected getConfigurableRecords(): Record<string, any> {
        return {...getConfigurableRecordsFromInstance(this)}
    }

    /**
     * The object which created this object (the module or component whose container created it).
     * @returns The parent, or undefined for an object created by a container without owner (the root container).
     * @protected
     */
    protected getParent(): BaseObject | undefined {
        return this.#container.parent?.owner()
    }

    /**
     * The nearest module among the object's parents (its module, or the application).
     * @returns The module; undefined (despite the type) for an object created outside any module.
     * @protected
     */
    protected getModule(): Module {
        let parent: BaseObject | undefined = this.getParent()
        while (parent && getObjectType(As<IBaseObjectConstructor>(objectConstructor(parent))) !== ObjectType.Module) {
            parent = parent.getParent()
        }
        return As<Module>(parent)
    }

    /**
     * A random UUID identifying the instance.
     */
    public get $uuid(): string {
        return this.#uniqueId
    }

    /**
     * The name the object was registered under (its key in the module options), or a symbol of its class for an object
     * registered by its class or built without registration.
     */
    public get $id(): string | symbol {
        return this.#objectId
    }

    /**
     * A symbol unique to the instance (made from its `$uuid`), created on first read.
     */
    public get $symbol(): symbol {
        if (Reflect.hasOwnMetadata(OSP, this)) return Reflect.getOwnMetadata(OSP, this)
        Reflect.defineMetadata(OSP, Symbol(this.$uuid), this)
        return this.$symbol
    }

    /**
     * Set a property of the object; the value is not validated, even for a `@Configurable` property.
     * @param propertyKey The property name.
     * @param value The value.
     */
    public setProperty(propertyKey: string, value: any): void {
        this[propertyKey] = value
    }

    /**
     * Read an own property of the object.
     * @param propertyKey The property name.
     * @param defaultValue The value returned when the object has no own property of this name.
     * @returns The property value, or the default value.
     */
    public getProperty<T = any>(propertyKey: string, defaultValue?: T): T {
        if (this.hasProperty(propertyKey)) return As<T>(this[propertyKey])
        return As<T>(defaultValue)
    }

    /**
     * Whether the object has an own property (not a method or accessor of its class) of this name or symbol.
     * @param propertyKey The property name or symbol.
     * @returns true when the property exists.
     */
    public hasProperty(propertyKey: string | symbol): boolean {
        return typeof propertyKey === 'string' ? this.propertyNames().includes(propertyKey) : this.propertySymbols().includes(propertyKey)
    }

    /**
     * The symbols of the object's own properties.
     * @returns The symbols.
     */
    public propertySymbols(): symbol[] {
        return Object.getOwnPropertySymbols(this)
    }

    /**
     * The names of the object's own properties (not its class's methods and accessors).
     * @returns The names.
     */
    public propertyNames(): string[] {
        return Object.getOwnPropertyNames(this)
    }

    /**
     * Whether the object has a method of this name or symbol (a function of its class, not an own property).
     * @param name The method name or symbol.
     * @returns true when the method exists.
     */
    public hasMethod(name: string | symbol): boolean {
        const propertyExists: boolean = this.hasProperty(name)
        if (propertyExists) return false //Method doesn't exist
        return typeof this[name] === 'function'
    }

    /**
     * Get a method bound to the object, to call it by name.
     * @param name The method name or symbol.
     * @param throwExceptionIfNotFound Throw when the method does not exist, instead of returning a function doing
     * nothing; false by default.
     * @returns The bound method, or a function doing nothing (returning undefined) when it does not exist.
     * @throws {MethodNotFoundException} When the method does not exist and `throwExceptionIfNotFound` is true.
     */
    public getMethod(name: string | symbol, throwExceptionIfNotFound: boolean = false): (...args: any[]) => any | Promise<any> {
        if (this.hasMethod(name)) {
            return (...args: any[]) => this[name](...args)
        } else if (throwExceptionIfNotFound) {
            throw new MethodNotFoundException('Method "{methodName}" not found in "{className}"', {
                methodName: name,
                className: this.constructor.name
            })
        } else {
            return (...args: any[]): void => DevNull(...args)
        }
    }

    /**
     * Destroy the object: its `beforeDestroy()`, the objects it created, then its `destroy()`. Calling it more than once
     * destroys once. A disposed singleton or scoped object is dropped from its container, which creates a new one on
     * the next request. Using a destroyed object (`getObject()`, `buildObject()`) throws an
     * {@link ObjectDestroyedException}.
     * @returns Resolves once the object is destroyed.
     * @throws {Error} The error of the object's own `beforeDestroy()` or `destroy()` (an `AggregateError` when several
     * fail); the errors of the objects it created are reported through the application's logger instead.
     */
    public async dispose(): Promise<void> {
        try {
            await this[__destroy]()
        } finally {
            //A disposed cached object (singleton, scoped) is dropped, so the container creates a new one next time
            const registrationName: string | symbol | undefined = getRegistrationNameFromInstance(this)
            if (registrationName !== undefined) this.#container.parent?.forget(registrationName, this)
        }
    }

    /**
     * Dispose the object at the end of an `await using` block, as {@link BaseObject.dispose}.
     * @returns Resolves once the object is destroyed.
     */
    public async [Symbol.asyncDispose](): Promise<void> {
        await this.dispose()
    }
}

registerBaseObject(BaseObject)
