import {createContainer, IDependencyInjectionContainer} from '../ioc/DependencyInjectionContainer.js'
import {DevNull} from '../base/func/DevNull.js'
import {BaseObject} from '../base/BaseObject.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {ConstructorSymbol} from '../base/internal/ConstructorSymbol.js'
import {IsPromise} from '../base/func/IsPromise.js'

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

    public async load<ClassConstructor extends typeof BaseObject>() {

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
    public async get<T extends BaseObject>(inp: string | symbol | IConstructor<T>, configurableRecords: Record<string, any>): Promise<T> {
        const registrationName: string | symbol = typeof inp === 'function' ? ConstructorSymbol(inp) : inp
        const resolved: T | Promise<T> = this.#dic.resolve(registrationName)
        //TODO 思考是否需要在未注册时允许动态注册并获取
        //TODO 注入参数
        this.updateTransientWeakRefs()
        return IsPromise(resolved) ? await resolved : resolved
    }

    public async set() {
        //TODO
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
