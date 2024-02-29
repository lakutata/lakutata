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
import {Accept} from '../../decorators/dto/Accept.js'
import {IsEmptyObject} from '../base/func/IsEmptyObject.js'
import {listModules, ModuleDescriptor} from '../ioc/ListModules.js'
import {pathToFileURL} from 'url'
import {isClass} from '../ioc/Utils.js'

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
     * @param options
     * @protected
     */
    protected buildNameAndRegistrationPairFromOptions<T extends BaseObject>(options: LoadObjectOptions): NameAndRegistrationPair<T> {
        const pair: NameAndRegistrationPair<T> = {}
        const id: string | symbol = options.id ? options.id : ConstructorSymbol(options.class)
        const configurableRecords: Record<string, any> = {...options, class: void (0)}
        delete configurableRecords.id
        delete configurableRecords.class
        SetConfigurableRecords(options.class, id, configurableRecords)
        pair[id] = asClass(options.class, {
            lifetime: GetObjectLifetime(options.class),
            dispose: (instance: BaseObject) => this.disposer(instance)
            // injector:()=>//TODO 暂时先不使用，若遇到有东西无法注入时再尝试使用
        })
        return pair
    }

    protected async buildNameAndRegistrationPairFromGlob<T extends typeof BaseObject>(glob: string): Promise<NameAndRegistrationPair<T>> {
        const formatPairPromises: Promise<NameAndRegistrationPair<T>>[] = []
        listModules('/Users/alex/WebstormProjects/lakutata/distro/src/tests/objs/**').forEach((moduleDescriptor: ModuleDescriptor) => {
            formatPairPromises.push(new Promise<NameAndRegistrationPair<T>>(resolve => {
                import(pathToFileURL(moduleDescriptor.path).toString()).then((importResult: Record<string, any>): void => {
                    Object.keys(importResult).forEach((exportName: string) => {
                        const exportObj: any = importResult[exportName]
                        if (isClass(exportObj) && DTO.isValid(exportObj, DTO.Class(BaseObject))) {
                            const objectConstructor: T = exportObj
                            const pair: NameAndRegistrationPair<T> = {}
                            pair[ConstructorSymbol(objectConstructor)] = asClass(objectConstructor, {
                                lifetime: GetObjectLifetime(objectConstructor),
                                dispose: (instance: BaseObject) => this.disposer(instance)
                            })
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
     * Load objects
     * @param options
     */
    @Accept(DTO.Array(DTO.Alternatives(LoadObjectOptions.Schema()), DTO.Class(() => BaseObject), DTO.Glob()))
    public async load<T extends typeof BaseObject>(options: (LoadObjectOptions | typeof BaseObject | string)[]): Promise<void> {
        let pair: NameAndRegistrationPair<T> = {}
        const buildNameAndRegistrationPairFromGlobPromises: Promise<NameAndRegistrationPair<T>>[] = []
        options.forEach((value: string | LoadObjectOptions | IConstructor<BaseObject>): void => {
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
        if (!IsEmptyObject(pair)) this.#dic.register(pair)
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
            await this.load([{
                id: registrationName,
                class: As<typeof BaseObject>(inp)
            }])
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
