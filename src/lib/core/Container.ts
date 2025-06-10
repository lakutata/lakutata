import {
    createContainer,
    type IDependencyInjectionContainer,
    type NameAndRegistrationPair
} from '../ioc/DependencyInjectionContainer.js'
import {__destroy, BaseObject} from '../base/BaseObject.js'
import {ConstructorSymbol} from '../base/internal/ConstructorSymbol.js'
import {LoadObjectOptions, OBJECT_ID} from '../../options/LoadObjectOptions.js'
import {asClass, asValue, type BuildResolverOptions} from '../ioc/Resolvers.js'
import {GetObjectLifetime} from '../base/internal/ObjectLifetime.js'
import {
    GetConfigurableRecords,
    SetConfigurableRecords,
    SetConfigurableRecordsToInstance, SetIdToInstance
} from '../base/internal/ConfigurableRecordsInjection.js'
import {DTO} from './DTO.js'
import {GetObjectIsAutoload} from '../base/internal/ObjectInjection.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {listModules, type ModuleDescriptor} from '../ioc/ListModules.js'
import {pathToFileURL} from 'url'
import {isClass} from '../ioc/Utils.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {LifetimeType} from '../ioc/Lifetime.js'
import {DevNull} from '../helpers/DevNull.js'
import {As} from '../helpers/As.js'
import {IsEmptyObject} from '../helpers/IsEmptyObject.js'
import {AppendObjectWeakRefs, ClearObjectWeakRefs, GetObjectWeakRefs} from '../base/internal/ObjectWeakRefs.js'

export const containerSymbol: symbol = Symbol('LAKUTATA.DI.CONTAINER.SYMBOL')

export const ownerSymbol: symbol = Symbol('LAKUTATA.DI.OWNER.SYMBOL')

export class Container {

    readonly #dic: IDependencyInjectionContainer

    #subContainerSet: Set<Container> = new Set()

    #destroyed: boolean = false

    public readonly parent?: Container

    constructor(parent?: Container, owner?: BaseObject) {
        this.parent = parent
        this.#dic = parent ? parent.#dic.createScope() : createContainer({
            injectionMode: 'PROXY',
            //strict must be false
            strict: false
        })
        if (this.parent) this.parent.#subContainerSet.add(this)
        this.#dic.register(containerSymbol, asValue(this))
        if (owner) this.#dic.register(ownerSymbol, asValue(new WeakRef(owner)))
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
            DevNull(e)
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
        const presetConfigurableRecords: Record<string, any> = GetConfigurableRecords(As<typeof BaseObject>(resolved.constructor), registrationName)
        const isValidSubBaseObject: boolean = DTO.isValid(resolved.constructor, DTO.Class(BaseObject))
        if (isValidSubBaseObject) {
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
        pair[id] = asClass(options.class, this.buildResolverOptions(options.class))
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
                        if (isClass(exportObj) && DTO.isValid(exportObj, DTO.Class(BaseObject))) {
                            const objectConstructor: T = exportObj
                            const pair: NameAndRegistrationPair<T> = {}
                            pair[ConstructorSymbol(objectConstructor)] = asClass(objectConstructor, this.buildResolverOptions(objectConstructor))
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
        if (!this.#dic.hasRegistration(registrationName) && typeof inp === 'function' && GetObjectIsAutoload(As<typeof BaseObject>(inp))) {
            await this.load([{
                id: registrationName,
                class: As<typeof BaseObject>(inp)
            }])
        }
        return (
            (
                this.#dic.getRegistration(registrationName)?.lifetime === 'SINGLETON'
                || this.#dic.getRegistration(registrationName)?.lifetime === 'MODULE_SINGLETON'
            )
            && !this.injectionNames.has(registrationName)
            && this.parent
        )
            ? await this.parent.get(registrationName, configurableRecords)
            : await this.processResolved(this.#dic.resolve(registrationName), registrationName, configurableRecords)
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
        await this.load([{
            ...configurableRecords,
            class: target
        }])
        return await this.get(target)
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
     * Builds an instance of a base object class by injecting dependencies, but without registering it in the container
     * @param target
     * @param configurableRecords
     */
    public async build<T extends BaseObject>(target: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        const builtObject: T = await this.processResolved(this.#dic.build<T>(target, this.buildResolverOptions(target)), ConstructorSymbol(target), configurableRecords)
        AppendObjectWeakRefs(this.#dic, builtObject)
        return builtObject
    }

    /**
     * Create sub container scope
     */
    public createScope(): Container {
        return new Container(this, this.owner())
    }

    /**
     * Register current container to its parent subContainerSet
     */
    public registerContainerToItsParent(): void {
        if (this.parent) this.parent.#subContainerSet.add(this)
    }

    /**
     * Clear current container but not destroy it
     */
    public async clear(): Promise<void> {
        const destroySubContainerPromises: Promise<void>[] = []
        this.#subContainerSet.forEach((subContainer: Container) =>
            destroySubContainerPromises.push(new Promise((resolve, reject) =>
                subContainer.destroy().then(resolve).catch(reject))))
        await Promise.all(destroySubContainerPromises)
        await this.#dic.dispose()
        const destroyTransientPromises: Promise<void>[] = []
        GetObjectWeakRefs(this.#dic).forEach((ref: WeakRef<BaseObject>): void => {
            let transient: BaseObject | undefined = ref.deref()
            if (!transient) return
            if (transient[__destroy]) {
                destroyTransientPromises.push(new Promise(resolve => transient ? Promise.resolve(transient[__destroy]()).then(() => {
                    transient = undefined
                    return resolve()
                }).catch(DevNull) : resolve()))
            }
        })
        await Promise.all(destroyTransientPromises)
        ClearObjectWeakRefs(this.#dic)
    }

    /**
     * Destroy current container
     */
    public async destroy(): Promise<void> {
        if (this.#destroyed) return
        this.#destroyed = true
        if (this.parent) this.parent.#subContainerSet.delete(this)
        await this.clear()
    }
}
