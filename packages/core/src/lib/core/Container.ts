import {
    createContainer,
    type IDependencyInjectionContainer,
    type NameAndRegistrationPair
} from '../ioc/DependencyInjectionContainer.js'
import {__destroy, BaseObject} from '../base/BaseObject.js'
import {ConstructorSymbol} from '../ioc/ConstructorSymbol.js'
import {LoadObjectOptions, OBJECT_ID} from '../../options/LoadObjectOptions.js'
import {asClass, asValue, type BuildResolver, type BuildResolverOptions, type DisposableResolver, type Resolver} from '../ioc/Resolvers.js'
import {GetObjectLifetime} from '../ioc/ObjectLifetime.js'
import {
    GetConfigurableRecords,
    GetRegistrationNameFromInstance,
    SetConfigurableRecords,
    SetConfigurableRecordsToInstance, SetIdToInstance
} from '../base/internal/ConfigurableRecordsInjection.js'
import {DTO} from '../dto/DTO.js'
import {GetObjectIsAutoload} from '../base/internal/ObjectInjection.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {listModules, type ModuleDescriptor} from '../ioc/ListModules.js'
import {pathToFileURL} from 'url'
import {isClass} from '../ioc/Utils.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {LifetimeType} from '../ioc/Lifetime.js'
import {ReportDestroyError} from '../foundation/LifecycleErrorReporter.js'
import {ThrowWarning} from '../foundation/ThrowWarning.js'
import {IsSubclassOf} from '@lakutata/utils/IsSubclassOf'
import {ObjectDestroyedException} from '../../exceptions/ObjectDestroyedException.js'
import {As} from '@lakutata/utils/As'
import {IsEmptyObject} from '@lakutata/utils/IsEmptyObject'
import {AppendObjectWeakRefs, ClearObjectWeakRefs, GetObjectWeakRefs} from '../ioc/ObjectWeakRefs.js'

export const containerSymbol: symbol = Symbol('LAKUTATA.DI.CONTAINER.SYMBOL')

export const ownerSymbol: symbol = Symbol('LAKUTATA.DI.OWNER.SYMBOL')

//The hooks run before the teardown of a container, by container
const teardownHooks: WeakMap<Container, Set<() => Promise<void>>> = new WeakMap()

/**
 * Register a hook run when a container starts its teardown, before its scopes and objects are destroyed
 * (an entrypoint stops receiving requests and waits for the requests in progress there), returns its unregistration
 * @param container
 * @param hook
 */
export function RegisterTeardownHook(container: Container, hook: () => Promise<void>): () => void {
    let hooks: Set<() => Promise<void>> | undefined = teardownHooks.get(container)
    if (!hooks) teardownHooks.set(container, hooks = new Set())
    hooks.add(hook)
    return (): void => void hooks!.delete(hook)
}

/**
 * The dependency injection container: it registers the classes of the objects (components, providers, modules, any
 * {@link BaseObject}), creates them on demand with their lifetime and destroys them with itself.
 *
 * An object is created asynchronously: its `@Inject` properties are resolved from the container, its `@Configurable`
 * properties get their configured values (validated and transformed by their schemas), then its `init()` runs; the
 * promise of `get()`, `set()` or `build()` settles once `init()` has completed. The lifetime of the class decides
 * which instance is returned:
 * - `@Singleton` (components, modules): one instance, held by the container which registered the class.
 * - `@Scoped` (providers): one instance per scope (see {@link Container.createScope}), such as per request.
 * - `@Transient` ({@link BaseObject}): a new instance on each request.
 *
 * The applications rarely create a container: the {@link Application} owns the root one, each object owns a child
 * container tracking the objects it creates (destroyed with it), and the modules and components reach theirs through
 * their protected `container` property. A container created with `new Container()` is a root container, to use the
 * objects without an application (tests, scripts).
 * @example
 * ```typescript
 * import {Component, Container, DTO, Provider} from 'lakutata'
 * import {Configurable, Inject} from 'lakutata/decorator/di'
 *
 * class Greeter extends Provider {
 *     //'Hello' unless configured
 *     @Configurable(DTO.String())
 *     protected readonly greeting: string = 'Hello'
 *
 *     public greet(name: string): string {
 *         return `${this.greeting}, ${name}`
 *     }
 * }
 *
 * class Reception extends Component {
 *     @Inject('greeter')
 *     protected readonly greeter!: Greeter
 *
 *     public welcome(name: string): string {
 *         return this.greeter.greet(name)
 *     }
 * }
 *
 * const container: Container = new Container()
 * await container.registerNamed('greeter', Greeter, {greeting: 'Welcome'})
 * const reception: Reception = await container.set(Reception)
 * console.log(reception.welcome('Ada')) //Welcome, Ada
 * await container.destroy()
 * ```
 */
export class Container {

    readonly #dic: IDependencyInjectionContainer

    /**
     * Removes the weak reference of a garbage collected sub object container from its parent
     * @private
     */
    static readonly #releasedContainerRegistry: FinalizationRegistry<{ refs: Set<WeakRef<Container>>, ref: WeakRef<Container> }> = new FinalizationRegistry(({refs, ref}): boolean => refs.delete(ref))

    /**
     * Sub scopes are held strongly, a scope lives until it is destroyed explicitly or together with its parent
     * @private
     */
    readonly #subScopeSet: Set<Container> = new Set()

    /**
     * Containers of sub objects are held weakly, they live as long as their owner objects
     * @private
     */
    readonly #subObjectContainerRefs: Set<WeakRef<Container>> = new Set()

    readonly #selfRef: WeakRef<Container> = new WeakRef(this)

    #destroyed: boolean = false

    #destroyPromise: Promise<void> | undefined

    /**
     * Whether current container is a scope (the root container or one created by createScope()),
     * an object's own container is not a scope, it only tracks the objects created by that object
     * @private
     */
    #isScope: boolean

    /**
     * The container this one was created from (the one of the object which created the owner, or the one a scope was
     * created from); undefined for a root container.
     */
    public readonly parent?: Container

    /**
     * Create a container. Without parent, a root container; with a parent, a container whose registrations fall back
     * to the parent's, destroyed together with it.
     * @param parent The parent container, none for a root container.
     * @param owner The object owning the container (the framework gives each object its own container).
     */
    constructor(parent?: Container, owner?: BaseObject) {
        this.parent = parent
        this.#isScope = !parent
        this.#dic = parent ? parent.#dic.createScope() : createContainer({
            //strict must be false
            strict: false
        })
        if (this.parent) Container.#releasedContainerRegistry.register(this, {
            refs: this.parent.#subObjectContainerRefs,
            ref: this.#selfRef
        })
        this.#attachToParent()
        this.#dic.register(containerSymbol, asValue(this))
        if (owner) this.#dic.register(ownerSymbol, asValue(new WeakRef(owner)))
    }

    /**
     * Let the parent track current container, so it is destroyed together with its parent
     * @private
     */
    #attachToParent(): void {
        if (!this.parent) return
        if (this.#isScope) {
            this.parent.#subScopeSet.add(this)
        } else {
            this.parent.#subObjectContainerRefs.add(this.#selfRef)
        }
    }

    /**
     * Create the resolver of a registration
     * @param target
     * @private
     */
    #createResolver(target: IBaseObjectConstructor): BuildResolver<any> & DisposableResolver<any> {
        return asClass(target, As<BuildResolverOptions<any>>(this.buildResolverOptions(target)))
    }

    /**
     * Throw if current container has been destroyed (or is being destroyed)
     * @private
     */
    #assertNotDestroyed(): void {
        if (this.#destroyed) throw new ObjectDestroyedException('The container has been destroyed')
    }

    /**
     * Get the nearest scope, starting from current container
     * @private
     */
    #nearestScope(): Container {
        let container: Container = this
        while (!container.#isScope && container.parent) container = container.parent
        return container
    }

    /**
     * Get the root container, the one without parent
     * @private
     */
    #root(): Container {
        let container: Container = this
        while (container.parent) container = container.parent
        return container
    }

    /**
     * Stop being tracked by the parent
     * @private
     */
    #detachFromParent(): void {
        if (!this.parent) return
        this.parent.#subScopeSet.delete(this)
        this.parent.#subObjectContainerRefs.delete(this.#selfRef)
    }

    /**
     * Destroy an object of the container during its teardown: its `beforeDestroy()`, the objects it created, then its
     * `destroy()`. Never throws: the errors are reported through the application's logger.
     * @param instance The object to destroy.
     * @returns Resolves once the object is destroyed.
     * @protected
     */
    protected async disposer<T extends BaseObject>(instance: T): Promise<void> {
        try {
            await instance.getMethod(__destroy, false)()
        } catch (e) {
            //Cascaded destruction never throws, errors are reported instead
            ReportDestroyError(e, instance.className)
        }
    }

    /**
     * The options of the resolver of a class: the lifetime declared by its decorators (`@Singleton`, `@Scoped`,
     * `@Transient`) and its disposer ({@link Container.disposer}).
     * @param target The class to register or build.
     * @returns The resolver options.
     * @protected
     */
    protected buildResolverOptions<T extends BaseObject>(target: IBaseObjectConstructor<T>): BuildResolverOptions<T> {
        const objectLifetime: LifetimeType = GetObjectLifetime(target)
        return {
            lifetime: objectLifetime,
            dispose: (instance: BaseObject) => this.disposer(instance)
        }
    }

    /**
     * Give an object just created by the container its registration name and its options: the options it was
     * registered with, overridden by the ones requested. An object already created (a cached singleton or scoped
     * instance) is returned as it is, the options requested being ignored with a warning outside production.
     * @param resolved The object, or the promise of its asynchronous construction.
     * @param registrationName The name (or class symbol) the object was requested by.
     * @param configurableRecords The options requested for the object.
     * @returns The object, once constructed.
     * @protected
     */
    protected async processResolved<T extends BaseObject>(resolved: T | Promise<T>, registrationName: string | symbol, configurableRecords: Record<string, any> = {}): Promise<T> {
        //Only a newly created object gets its id and configurable records, a cached one is already initialized
        const isSubBaseObject: boolean = IsSubclassOf(resolved?.constructor, BaseObject)
        const isNewSubBaseObject: boolean = isSubBaseObject && GetRegistrationNameFromInstance(As<T>(resolved)) === undefined
        if (isSubBaseObject && !isNewSubBaseObject && !IsEmptyObject(configurableRecords) && process.env.NODE_ENV !== 'production') {
            ThrowWarning(`The configuration passed for the already created object "${As<T>(resolved).className}" is ignored. Use a scoped or transient object to get an instance with its own configuration.`)
        }
        if (isNewSubBaseObject) {
            const presetConfigurableRecords: Record<string, any> = GetConfigurableRecords(As<typeof BaseObject>(resolved.constructor), registrationName)
            //set id into object instance
            SetIdToInstance(As<T>(resolved), registrationName)
            //set configurable records into object instance
            SetConfigurableRecordsToInstance(As<T>(resolved), {...presetConfigurableRecords, ...configurableRecords})
        }
        return Promise.resolve(resolved)
    }

    /**
     * Build the registration of an object declaration: its name is its id (the name it is declared under) or, without
     * id, a symbol of its class; its other options are kept as the options it is created with.
     * @param options The object declaration.
     * @returns The registration, keyed by its name.
     * @protected
     */
    protected buildNameAndRegistrationPairFromOptions<T extends BaseObject>(options: LoadObjectOptions): NameAndRegistrationPair<T> {
        const pair: NameAndRegistrationPair<T> = {}
        const id: string | symbol = options[OBJECT_ID] ? options[OBJECT_ID] : ConstructorSymbol(options.class)
        const configurableRecords: Record<string, any> = {...options, class: void (0)}
        delete configurableRecords.id
        delete configurableRecords.class
        SetConfigurableRecords(options.class, id, configurableRecords)
        pair[id] = this.#createResolver(options.class)
        return pair
    }

    /**
     * Build the registrations of the classes found by a glob pattern: each file matched is imported, and registered
     * under the symbol of its class when its first export is a {@link BaseObject} subclass; a file whose first export is
     * not, or which fails to import, registers nothing.
     * @param glob The glob pattern of the files to import, relative to the working directory (the aliases are not
     * replaced in it).
     * @returns The registrations, keyed by their class symbols.
     * @protected
     */
    protected async buildNameAndRegistrationPairFromGlob<T extends typeof BaseObject>(glob: string): Promise<NameAndRegistrationPair<T>> {
        const formatPairPromises: Promise<NameAndRegistrationPair<T>>[] = []
        listModules(glob).forEach((moduleDescriptor: ModuleDescriptor): void => {
            formatPairPromises.push(new Promise<NameAndRegistrationPair<T>>(resolve => {
                import(pathToFileURL(moduleDescriptor.path).toString()).then((importResult: Record<string, any>): void => {
                    Object.keys(importResult).forEach((exportName: string): void => {
                        const exportObj: any = importResult[exportName]
                        if (isClass(exportObj) && IsSubclassOf(exportObj, BaseObject)) {
                            const objectConstructor: T = exportObj
                            const pair: NameAndRegistrationPair<T> = {}
                            pair[ConstructorSymbol(objectConstructor)] = this.#createResolver(objectConstructor)
                            return resolve(pair)
                        } else {
                            return resolve({})
                        }
                    })
                }).catch(() => resolve({}))
            }))
        })
        const pairs: NameAndRegistrationPair<T>[] = await Promise.all(formatPairPromises)
        let result: NameAndRegistrationPair<T> = {}
        pairs.forEach((pair: NameAndRegistrationPair<T>): void => {
            result = {...result, ...pair}
        })
        return result
    }

    /**
     * The object owning the container (the one whose container it is, or the owner of the container a scope was
     * created from).
     * @returns The owner, or undefined for a container without owner or whose owner was garbage collected.
     */
    public owner<Owner extends BaseObject = BaseObject>(): Owner | undefined {
        const owner: WeakRef<Owner> | undefined = this.#dic.resolve(ownerSymbol, {allowUnregistered: true})
        return owner ? owner.deref() : undefined
    }

    /**
     * The names registered by this container itself (not by its parents); a singleton is resolved by the container
     * which registered it, a scoped object by the nearest scope.
     * @protected
     */
    protected injectionNames: Set<string | symbol> = new Set()

    /**
     * Register objects in the container, without creating them: a class is registered under the symbol of its class
     * (got by its class), a declaration with an id under its id (got by its name) with its options, a glob pattern
     * registers the classes of the files it matches. A name registered again replaces the previous registration.
     * @param options The classes, declarations (`{class, ...options}`) and glob patterns to register.
     * @returns Resolves once registered (the glob patterns imported).
     * @throws {InvalidMethodAcceptException} When an item is neither a class, a declaration nor a glob pattern.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     */
    @Accept(DTO.Array(DTO.Alternatives(LoadObjectOptions.Schema(), DTO.Class(() => BaseObject), DTO.Glob())))
    public async load<T extends typeof BaseObject>(options: (LoadObjectOptions | typeof BaseObject | string)[]): Promise<void> {
        this.#assertNotDestroyed()
        let pair: NameAndRegistrationPair<T> = {}
        const buildNameAndRegistrationPairFromGlobPromises: Promise<NameAndRegistrationPair<T>>[] = []
        options.forEach((value: string | LoadObjectOptions | IBaseObjectConstructor): void => {
            if (typeof value === 'string') {
                //glob
                buildNameAndRegistrationPairFromGlobPromises.push(this.buildNameAndRegistrationPairFromGlob<T>(value))
            } else if (isClass(As<any>(value))) {
                const loadObjectOptions: LoadObjectOptions = {class: As<typeof BaseObject>(value)}
                pair = {...pair, ...this.buildNameAndRegistrationPairFromOptions(loadObjectOptions)}
            } else {
                //load options
                const loadObjectOptions: LoadObjectOptions = As<LoadObjectOptions>(value)
                pair = {...pair, ...this.buildNameAndRegistrationPairFromOptions(loadObjectOptions)}
            }
        })
        if (buildNameAndRegistrationPairFromGlobPromises.length) {
            const pairs: NameAndRegistrationPair<T>[] = await Promise.all(buildNameAndRegistrationPairFromGlobPromises)
            pairs.forEach((_pair: NameAndRegistrationPair<T>): void => {
                pair = {..._pair, ...pair}
            })
        }
        if (!IsEmptyObject(pair)) {
            Object.getOwnPropertyNames(pair).forEach(value => this.injectionNames.add(value))
            Object.getOwnPropertySymbols(pair).forEach(value => this.injectionNames.add(value))
            this.#dic.register(pair)
        }
    }

    /**
     * Get an object registered by its class, creating it when the lifetime requires: a singleton is created once, a
     * scoped object once per scope, a transient object on each call. A class marked `@Autoload` is registered on first
     * request (its singleton in the root container, its scoped object in the nearest scope). A scoped object requested
     * with options is a new instance owned by the caller, not the one shared within the scope (see
     * {@link Container.getShared}).
     * @param constructor The class the object was registered with (an object registered under a name is not found by
     * its class).
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with; validated when the object is created. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists.
     * @returns The object, once its dependencies are injected, its options applied and its `init()` completed.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the class is not registered here or in a parent container, or the object fails to be
     * created (an injection failing with a {@link DependencyInjectionException}, an invalid option, an error of `init()`).
     */
    public async get<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name, as {@link Container.get} by class.
     * @param name The name the object was registered under (its key in the module options).
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with; validated when the object is created. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the name is not registered, or the object fails to be created.
     */
    public async get<T extends BaseObject>(name: string, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a symbol, as {@link Container.get} by class.
     * @param name The symbol the object was registered under.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with; validated when the object is created. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the symbol is not registered, or the object fails to be created.
     */
    public async get<T extends BaseObject>(name: symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name or a symbol, as {@link Container.get} by class.
     * @param name The name or symbol the object was registered under.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with; validated when the object is created. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the name is not registered, or the object fails to be created.
     */
    public async get<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get an object registered under a name, a symbol or by its class, as {@link Container.get} by class.
     * @param nameOrConstructor The name, symbol or class the object was registered with.
     * @param configurableRecords The options of the object (the values of its `@Configurable` properties and the options
     * it reads), merged over the ones it was registered with; validated when the object is created. Ignored, with a
     * warning outside production, when the cached singleton or scoped instance already exists.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When it is not registered, or the object fails to be created.
     */
    public async get<T extends BaseObject>(nameOrConstructor: string | symbol | IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    public async get<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return await this.#get(inp, configurableRecords, false)
    }

    /**
     * Get the shared instance of an object registered by its class (the container's instance, or the scope's instance
     * for a scoped object), created with the options when it does not exist yet. Unlike {@link Container.get}, a scoped
     * object requested with options is not a new instance owned by the caller: the creator of a scope uses it to provide
     * an object configured for the request, which the request's objects then share.
     * @param constructor The class the object was registered with.
     * @param configurableRecords The options of the object, used only when the shared instance is created now; ignored,
     * with a warning outside production, when it exists already.
     * @returns The shared object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the class is not registered, or the object fails to be created.
     */
    public async getShared<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get the shared instance of an object registered under a name or a symbol, as {@link Container.getShared} by
     * class.
     * @param name The name or symbol the object was registered under.
     * @param configurableRecords The options of the object, used only when the shared instance is created now.
     * @returns The shared object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the name is not registered, or the object fails to be created.
     */
    public async getShared<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    public async getShared<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return await this.#get(inp, configurableRecords, true)
    }

    /**
     * Get a registered object
     * @param inp
     * @param configurableRecords
     * @param shared whether a scoped object requested with a configuration is the shared instance
     * @private
     */
    async #get<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any>, shared: boolean): Promise<T> {
        const registrationName: string | symbol = typeof inp === 'function' ? ConstructorSymbol(inp) : inp
        this.#assertNotDestroyed()
        if (!this.#dic.hasRegistration(registrationName) && typeof inp === 'function' && GetObjectIsAutoload(As<typeof BaseObject>(inp))) {
            //An autoloaded scoped object is registered in the nearest scope, so it is shared within the request;
            //an autoloaded singleton in the root container, so it is shared by every object of the application
            const lifetime: LifetimeType = As<LifetimeType>(GetObjectLifetime(As<typeof BaseObject>(inp)))
            const registerContainer: Container = lifetime === 'SCOPED' ? this.#nearestScope() : lifetime === 'SINGLETON' ? this.#root() : this
            await registerContainer.load([{
                id: registrationName,
                class: As<typeof BaseObject>(inp)
            }])
        }
        const registration: Resolver<any> | null = this.#dic.getRegistration(registrationName)
        const lifetime: LifetimeType | undefined = registration?.lifetime
        //A scoped object requested with its own configuration is a new instance owned by the requester, it is not cached,
        //so it never replaces the instance shared within the request (unless the shared instance is requested)
        if (!shared && registration && lifetime === 'SCOPED' && !IsEmptyObject(configurableRecords)) {
            const configured: T = await this.processResolved(this.#dic.build<T>(registration), registrationName, configurableRecords)
            AppendObjectWeakRefs(this.#dic, configured)
            return configured
        }
        let resolver: Container = this
        if (lifetime === 'SINGLETON') {
            //Singletons are resolved by the container which registered them
            while (!resolver.injectionNames.has(registrationName) && resolver.parent) resolver = resolver.parent
        } else if (lifetime === 'SCOPED') {
            //Scoped objects are resolved by the nearest scope (one instance per request), or by the container which registered them
            while (!resolver.injectionNames.has(registrationName) && !resolver.#isScope && resolver.parent) resolver = resolver.parent
        }
        resolver.#assertNotDestroyed()
        return await resolver.processResolved(resolver.#dic.resolve(registrationName), registrationName, configurableRecords)
    }

    /**
     * Whether an object is registered under a symbol, in this container or one of its parents.
     * @param symbol The registration symbol.
     * @returns true when registered.
     */
    public has(symbol: symbol): boolean
    /**
     * Whether an object is registered under a name, in this container or one of its parents.
     * @param name The registration name.
     * @returns true when registered.
     */
    public has(name: string): boolean
    /**
     * Whether an object is registered under a name or a symbol, in this container or one of its parents.
     * @param nameOrSymbol The registration name or symbol.
     * @returns true when registered.
     */
    public has(nameOrSymbol: string | symbol): boolean
    /**
     * Whether a class is registered by its class (not under a name), in this container or one of its parents; an
     * `@Autoload` class not requested yet is not registered.
     * @param constructor The class.
     * @returns true when registered.
     */
    public has<ClassConstructor extends typeof BaseObject>(constructor: ClassConstructor): boolean
    public has<ClassConstructor extends typeof BaseObject>(inp: symbol | string | ClassConstructor): boolean {
        if (typeof inp === 'function') return this.#dic.hasRegistration(ConstructorSymbol(inp))
        return this.#dic.hasRegistration(inp)
    }

    /**
     * Register a class (unless it is registered already) and get its object, as {@link Container.get}.
     * @param target The class.
     * @param configurableRecords The options of the object: registered with the class when it is registered now, and
     * requested for the object.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the object fails to be created.
     */
    public async set<T extends BaseObject>(target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        if (!this.has(target)) {
            await this.load([{
                ...configurableRecords,
                class: target
            }])
        }
        return await this.get(target, {
            ...configurableRecords
        })
    }

    /**
     * Register a class under a name, replacing a previous registration of the name, and get its object.
     * @param name The registration name or symbol.
     * @param target The class.
     * @param configurableRecords The options the object is registered with.
     * @returns The object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the object fails to be created.
     */
    public async setNamed<T extends BaseObject>(name: string | symbol, target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        await this.load([{
            ...configurableRecords,
            class: target,
            [OBJECT_ID]: name
        }])
        return await this.get(name)
    }

    /**
     * Register a class by its class, without creating its object; a class registered again replaces its previous
     * registration.
     * @param target The class.
     * @param configurableRecords The options its objects are created with.
     * @returns Resolves once registered.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     */
    public async register<T extends BaseObject>(target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<void> {
        await this.load([{
            ...configurableRecords,
            class: target
        }])
    }

    /**
     * Register a class under a name, without creating its object; a name registered again replaces its previous
     * registration.
     * @param name The registration name or symbol.
     * @param target The class.
     * @param configurableRecords The options its objects are created with.
     * @returns Resolves once registered.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     */
    public async registerNamed<T extends BaseObject>(name: string | symbol, target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<void> {
        await this.load([{
            ...configurableRecords,
            class: target,
            [OBJECT_ID]: name
        }])
    }

    /**
     * Create a new object of a class without registering it, whatever its lifetime: its dependencies are injected
     * from this container, and it is destroyed with this container (unless disposed before).
     * @param target The class, registered or not.
     * @param configurableRecords The options of the object.
     * @returns The new object, once created and initialized.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     * @throws {Error} When the object fails to be created.
     */
    public async build<T extends BaseObject>(target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        this.#assertNotDestroyed()
        const builtObject: T = await this.processResolved(this.#dic.build<T>(target, this.buildResolverOptions(target)), ConstructorSymbol(target), configurableRecords)
        AppendObjectWeakRefs(this.#dic, builtObject)
        return builtObject
    }

    /**
     * Create a scope: a child container holding its own instances of the scoped objects (one per scope, such as one per
     * request), the singletons and registrations of this container being shared. The scope lives until it is destroyed
     * explicitly, or together with this container.
     * @returns The new scope.
     * @throws {ObjectDestroyedException} When the container has been destroyed.
     */
    public createScope(): Container {
        this.#assertNotDestroyed()
        const scope: Container = new Container(this, this.owner())
        scope.#detachFromParent()
        scope.#isScope = true
        scope.#attachToParent()
        return scope
    }

    /**
     * Track this container in its parent again, so it is destroyed together with the parent (used when its owner is
     * initialized again).
     */
    public registerContainerToItsParent(): void {
        this.#attachToParent()
    }

    /**
     * Make a destroyed container usable again, when its owner is reloaded.
     * @throws {ObjectDestroyedException} When the parent container has been destroyed (or is being destroyed).
     */
    public revive(): void {
        if (this.parent && this.parent.#destroyed) throw new ObjectDestroyedException('Cannot revive a container whose parent container has been destroyed')
        this.#destroyed = false
        this.#destroyPromise = undefined
        this.#attachToParent()
    }

    /**
     * Drop the cached instance of a registration, so the next request creates a new one; nothing happens when the
     * cached instance is not the one given.
     * @param name The registration name or symbol.
     * @param instance The instance to drop.
     */
    public forget(name: string | symbol, instance: BaseObject): void {
        const cached: { value: any } | undefined = this.#dic.cache.get(name)
        if (cached && cached.value === instance) this.#dic.cache.delete(name)
    }

    /**
     * Destroy the container's objects and scopes, the container remaining usable: the teardown hooks run (the
     * entrypoints stop), then the scopes and the containers of the objects are destroyed, then the cached objects and
     * the transient objects still alive. Never throws: the errors are reported through the application's logger, and a
     * failing object does not stop the teardown of the others.
     * @returns Resolves once everything is destroyed.
     */
    public async clear(): Promise<void> {
        //Every step always runs to the end, a failing object never stops the teardown of the others
        const hooks: Set<() => Promise<void>> | undefined = teardownHooks.get(this)
        if (hooks?.size) {
            const results: PromiseSettledResult<void>[] = await Promise.allSettled([...hooks].map((hook: () => Promise<void>): Promise<void> => hook()))
            results.forEach((result: PromiseSettledResult<void>): unknown => result.status === 'rejected' && ReportDestroyError(result.reason))
        }
        const subContainers: Container[] = [...this.#subScopeSet]
        this.#subObjectContainerRefs.forEach((ref: WeakRef<Container>): void => {
            const subContainer: Container | undefined = ref.deref()
            if (subContainer) subContainers.push(subContainer)
        })
        await Promise.all(subContainers.map((subContainer: Container): Promise<void> => subContainer.destroy()))
        try {
            await this.#dic.dispose()
        } catch (e) {
            ReportDestroyError(e)
        }
        const transients: BaseObject[] = []
        GetObjectWeakRefs<BaseObject>(this.#dic).forEach((ref: WeakRef<BaseObject>): void => {
            const transient: BaseObject | undefined = ref.deref()
            if (transient) transients.push(transient)
        })
        await Promise.all(transients.map((transient: BaseObject): Promise<void> => this.disposer(transient)))
        ClearObjectWeakRefs(this.#dic)
    }

    /**
     * Destroy the container: as {@link Container.clear}, then the container refuses any further request with an
     * {@link ObjectDestroyedException}. A concurrent or repeated call waits for the same teardown.
     * @returns Resolves once the container is destroyed.
     */
    public async destroy(): Promise<void> {
        //A teardown already in progress is awaited, not skipped
        if (this.#destroyPromise) return await this.#destroyPromise
        this.#destroyed = true
        this.#detachFromParent()
        this.#destroyPromise = this.clear()
        await this.#destroyPromise
    }
}
