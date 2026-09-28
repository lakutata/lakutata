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
import {ReportDestroyError} from '../foundation/DestroyErrorReporter.js'
import {ThrowWarning} from '../foundation/ThrowWarning.js'
import {GetObjectType, ObjectType} from '../base/internal/ObjectType.js'
import {IsSubclassOf} from '../helpers/internal/IsSubclassOf.js'
import {ObjectDestroyedException} from '../../exceptions/ObjectDestroyedException.js'
import {As} from '../helpers/As.js'
import {IsEmptyObject} from '../helpers/IsEmptyObject.js'
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
 * Resolver property holding the class of a registration
 */
const registeredClassSymbol: symbol = Symbol('LAKUTATA.DI.REGISTERED_CLASS.SYMBOL')

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

    public readonly parent?: Container

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
     * Create the resolver of a registration, remembering the registered class
     * @param target
     * @private
     */
    #createResolver(target: IBaseObjectConstructor): BuildResolver<any> & DisposableResolver<any> {
        const resolver: BuildResolver<any> & DisposableResolver<any> = asClass(target, As<BuildResolverOptions<any>>(this.buildResolverOptions(target)))
        Reflect.set(resolver, registeredClassSymbol, target)
        return resolver
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
     * Destroy objects inside container
     * @param instance
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
     * Get build resolver options by class constructor
     * @param target
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
     * Process resolved
     * @param resolved
     * @param registrationName
     * @param configurableRecords
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
     * Build name and registration pair from container load options
     * @param options
     * @protected
     */
    protected buildNameAndRegistrationPairFromOptions<T extends BaseObject>(options: LoadObjectOptions): NameAndRegistrationPair<T> {
        const pair: NameAndRegistrationPair<T> = {}
        const id: string | symbol = options[OBJECT_ID] ? options[OBJECT_ID] : ConstructorSymbol(options.class)
        const configurableRecords: Record<string, any> = {...options, class: void (0)}
        delete configurableRecords.id
        delete configurableRecords.class
        SetConfigurableRecords(options.class, id, configurableRecords)
        // @ts-ignore
        pair[id] = this.#createResolver(options.class)
        return pair
    }

    /**
     * Build name and registration pair from glob
     * @param glob
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
     * Get current container owner
     */
    public owner<Owner extends BaseObject = BaseObject>(): Owner | undefined {
        const owner: WeakRef<Owner> | undefined = this.#dic.resolve(ownerSymbol, {allowUnregistered: true})
        return owner ? owner.deref() : undefined
    }

    protected injectionNames: Set<string | symbol> = new Set()

    /**
     * Load objects
     * @param options
     */
    @Accept(DTO.Array(DTO.Alternatives(LoadObjectOptions.Schema(), DTO.Class(() => BaseObject), DTO.Glob())))
    public async load<T extends typeof BaseObject>(options: (LoadObjectOptions | typeof BaseObject | string)[]): Promise<void> {
        this.#assertNotDestroyed()
        let pair: NameAndRegistrationPair<T> = {}
        const buildNameAndRegistrationPairFromGlobPromises: Promise<NameAndRegistrationPair<T>>[] = []
        options.forEach((value: string | LoadObjectOptions | IBaseObjectConstructor): void => {
            if (typeof value === 'string') {
                //glob
                buildNameAndRegistrationPairFromGlobPromises.push(new Promise<NameAndRegistrationPair<T>>((resolve, reject) => this.buildNameAndRegistrationPairFromGlob<T>(value).then(resolve).catch(reject)))
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
     * Get registered object via constructor
     * @param constructor
     * @param configurableRecords
     */
    public async get<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string
     * @param name
     * @param configurableRecords
     */
    public async get<T extends BaseObject>(name: string, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via symbol
     * @param name
     * @param configurableRecords
     */
    public async get<T extends BaseObject>(name: symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string or symbol
     * @param name
     * @param configurableRecords
     */
    public async get<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string or symbol or constructor
     * @param nameOrConstructor
     * @param configurableRecords
     */
    public async get<T extends BaseObject>(nameOrConstructor: string | symbol | IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    public async get<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
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
        //so it never replaces the instance shared within the request (a controller keeps its per-request instance)
        if (registration && lifetime === 'SCOPED' && !IsEmptyObject(configurableRecords)) {
            const registeredClass: IBaseObjectConstructor | undefined = Reflect.get(registration, registeredClassSymbol)
            if (!registeredClass || GetObjectType(registeredClass) !== ObjectType.Controller) {
                const configured: T = await this.processResolved(this.#dic.build<T>(registration), registrationName, configurableRecords)
                AppendObjectWeakRefs(this.#dic, configured)
                return configured
            }
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
     * Is object registered in container (By symbol)
     * @param symbol
     */
    public has(symbol: symbol): boolean
    /**
     * Is object registered in container (By name)
     * @param name
     */
    public has(name: string): boolean
    /**
     * Is object registered in container (By name or symbol)
     * @param nameOrSymbol
     */
    public has(nameOrSymbol: string | symbol): boolean
    /**
     * Is object registered in container (By constructor)
     * @param constructor
     */
    public has<ClassConstructor extends typeof BaseObject>(constructor: ClassConstructor): boolean
    public has<ClassConstructor extends typeof BaseObject>(inp: symbol | string | ClassConstructor): boolean {
        if (typeof inp === 'function') return this.#dic.hasRegistration(ConstructorSymbol(inp))
        return this.#dic.hasRegistration(inp)
    }

    /**
     * Builds an instance of a base object class by injecting dependencies, and registering it in the container
     * @param target
     * @param configurableRecords
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
     * Builds a named instance of a base object class by injecting dependencies, and registering it in the container
     * @param name
     * @param target
     * @param configurableRecords
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
     * Register base object class in the container
     * @param target
     * @param configurableRecords
     */
    public async register<T extends BaseObject>(target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<void> {
        await this.load([{
            ...configurableRecords,
            class: target
        }])
    }

    /**
     * Register named base object class in the container
     * @param name
     * @param target
     * @param configurableRecords
     */
    public async registerNamed<T extends BaseObject>(name: string | symbol, target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<void> {
        await this.load([{
            ...configurableRecords,
            class: target,
            [OBJECT_ID]: name
        }])
    }

    /**
     * Builds an instance of a base object class by injecting dependencies, but without registering it in the container
     * @param target
     * @param configurableRecords
     */
    public async build<T extends BaseObject>(target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        this.#assertNotDestroyed()
        const builtObject: T = await this.processResolved(this.#dic.build<T>(target, this.buildResolverOptions(target)), ConstructorSymbol(target), configurableRecords)
        AppendObjectWeakRefs(this.#dic, builtObject)
        return builtObject
    }

    /**
     * Create sub container scope
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
     * Register current container to its parent
     */
    public registerContainerToItsParent(): void {
        this.#attachToParent()
    }

    /**
     * Make a destroyed container usable again, its owner is being reloaded
     * @description Fails when the parent container has been destroyed (or is being destroyed)
     */
    public revive(): void {
        if (this.parent && this.parent.#destroyed) throw new ObjectDestroyedException('Cannot revive a container whose parent container has been destroyed')
        this.#destroyed = false
        this.#destroyPromise = undefined
        this.#attachToParent()
    }

    /**
     * Drop the cached instance of a registration, so the next resolution creates a new one
     * @param name
     * @param instance
     */
    public forget(name: string | symbol, instance: BaseObject): void {
        const cached: { value: any } | undefined = this.#dic.cache.get(name)
        if (cached && cached.value === instance) this.#dic.cache.delete(name)
    }

    /**
     * Clear current container but not destroy it
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
     * Destroy current container
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
