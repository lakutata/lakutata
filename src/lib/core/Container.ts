import {
    createContainer,
    IDependencyInjectionContainer,
    NameAndRegistrationPair
} from '../ioc/DependencyInjectionContainer.js'
import {DevNull} from '../base/func/DevNull.js'
import {BaseObject} from '../base/BaseObject.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {ConstructorSymbol} from '../base/internal/ConstructorSymbol.js'
import {IsPromise} from '../base/func/IsPromise.js'
import {ContainerLoadOptions} from '../../options/ContainerLoadOptions.js'
import {LoadObjectOptions} from '../../options/LoadObjectOptions.js'
import {asClass, asValue} from '../ioc/Resolvers.js'
import {GetObjectLifetime} from '../base/internal/ObjectLifetime.js'
import {
    GetConfigurableRecords,
    SetConfigurableRecords,
    SetConfigurableRecordsToInstance
} from '../base/internal/ConfigurableRecordsInjection.js'
import {As} from '../base/func/As.js'
import {DTO} from './DTO.js'
import {GetObjectIsAutoload} from '../base/internal/ObjectInjection.js'
import {DI_CONTAINER_NEW_TRANSIENT_CALLBACK} from '../../constants/metadata-keys/DIMetadataKey.js'

export const containerSymbol: symbol = Symbol('LAKUTATA.DI.CONTAINER.SYMBOL')

export class Container {

    readonly #dic: IDependencyInjectionContainer

    #subContainerSet: Set<Container> = new Set()

    #transientWeakRefs: WeakRef<any>[] = []

    protected readonly parent?: Container

    constructor(parent?: Container) {
        this.parent = parent
        this.#dic = parent ? parent.#dic.createScope() : createContainer({injectionMode: 'PROXY', strict: true})
        if (this.parent) this.parent.#subContainerSet.add(this)
        Object.defineProperty(this.#dic, 'newTransient', {
            set: (resolvedWeakRef: WeakRef<any>): void => {
                this.#transientWeakRefs.push(resolvedWeakRef)
                this.updateTransientWeakRefs()
            }
        })
        Object.defineProperty(this.#dic, DI_CONTAINER_NEW_TRANSIENT_CALLBACK, {
            value: (resolvedWeakRef: WeakRef<any>): void => {
                this.#transientWeakRefs.push(resolvedWeakRef)
                this.updateTransientWeakRefs()
            }
        })
        this.#dic.register(containerSymbol, asValue(this))
    }

    /**
     * Update transient object weakRef list
     * @protected
     */
    protected updateTransientWeakRefs(): void {
        const __$transientWeakRefs: WeakRef<any>[] = []
        for (const ref of this.#transientWeakRefs) {
            const transient = ref.deref()
            if (transient !== undefined) __$transientWeakRefs.push(new WeakRef(transient))
        }
        this.#transientWeakRefs = __$transientWeakRefs
    }

    /**
     * Destroy objects inside container
     * @param instance
     * @protected
     */
    protected async disposer<T extends BaseObject>(instance: T): Promise<void> {
        try {
            await instance.getMethod('__destroy', false)()
            await instance.getMethod('destroy', false)()
        } catch (e) {
            DevNull(e)
        }
        this.updateTransientWeakRefs()
    }

    /**
     * Build name and registration pair from container load options
     * @param key
     * @param options
     * @protected
     */
    protected buildNameAndRegistrationPairFromOptions<T extends BaseObject>(key: string | symbol, options: ContainerLoadOptions): NameAndRegistrationPair<T> {
        const pair: NameAndRegistrationPair<T> = {}
        const constructorOrOptions: typeof BaseObject | LoadObjectOptions = options[key]
        const loadObjectOptions: LoadObjectOptions = typeof constructorOrOptions == 'function' ? {class: constructorOrOptions} : constructorOrOptions
        const configurableRecords: Record<string, any> = {...loadObjectOptions, class: void (0)}
        delete configurableRecords.class
        SetConfigurableRecords(loadObjectOptions.class, key, configurableRecords)
        pair[key] = asClass(loadObjectOptions.class, {
            lifetime: GetObjectLifetime(loadObjectOptions.class),
            dispose: (instance: BaseObject) => this.disposer(instance)
            // injector:()=>//TODO 暂时先不使用，若遇到有东西无法注入时再尝试使用
        })
        return pair
    }

    /**
     * Load objects
     * @param options
     */
    public async load<T extends BaseObject>(options: ContainerLoadOptions): Promise<void> {
        const symbolRegistrationPairs: NameAndRegistrationPair<T>[] = Object.getOwnPropertySymbols(options).map((key: symbol) => this.buildNameAndRegistrationPairFromOptions(key, options))
        const stringRegistrationPairs: NameAndRegistrationPair<T>[] = Object.getOwnPropertyNames(options).map((key: string) => this.buildNameAndRegistrationPairFromOptions(key, options))
        const pair: NameAndRegistrationPair<T> = Object.assign({}, ...symbolRegistrationPairs, ...stringRegistrationPairs)
        this.#dic.register(pair)
        this.updateTransientWeakRefs()
    }

    /**
     * Get registered object via constructor
     * @param constructor
     * @param configurableRecords
     */
    public async get<T extends BaseObject>(constructor: IConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
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
    public async get<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    public async get<T extends BaseObject>(nameOrConstructor: string | symbol | IConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    public async get<T extends BaseObject>(inp: string | symbol | IConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        const registrationName: string | symbol = typeof inp === 'function' ? ConstructorSymbol(inp) : inp
        if (!this.#dic.hasRegistration(registrationName) && typeof inp === 'function' && GetObjectIsAutoload(As<typeof BaseObject>(inp))) {
            await this.load({
                [registrationName]: As<typeof BaseObject>(inp)
            })
        }
        const resolved: T | Promise<T> = this.#dic.resolve(registrationName)
        const presetConfigurableRecords: Record<string, any> = GetConfigurableRecords(As<typeof BaseObject>(resolved.constructor), registrationName)
        const isValidSubBaseObject: boolean = DTO.isValid(resolved.constructor, DTO.Class(BaseObject))
        if (isValidSubBaseObject) SetConfigurableRecordsToInstance(As<T>(resolved), Object.assign({}, presetConfigurableRecords, configurableRecords))
        this.updateTransientWeakRefs()
        return IsPromise(resolved) ? await resolved : resolved
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
     * Create sub container scope
     */
    public createScope(): Container {
        this.updateTransientWeakRefs()
        return new Container(this)
    }

    /**
     * Destroy current container
     */
    public async destroy(): Promise<void> {
        if (this.parent) this.parent.#subContainerSet.delete(this)
        const destroySubContainerPromises: Promise<void>[] = []
        this.#subContainerSet.forEach((subContainer: Container) =>
            destroySubContainerPromises.push(new Promise((resolve, reject) =>
                subContainer.destroy().then(resolve).catch(reject))))
        await this.#dic.dispose()
        for (const ref of this.#transientWeakRefs) {
            const transient = ref.deref()
            try {
                if (transient?.__destroy) await transient.__destroy()
                if (transient?.destroy) await transient.destroy()
            } catch (e) {
                DevNull(e)
            }
        }
    }
}
