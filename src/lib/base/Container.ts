import {createContainer, IDependencyInjectionContainer} from '../ioc/DependencyInjectionContainer.js'
import {DevNull} from './func/DevNull.js'
import {BaseObject} from './BaseObject.js'

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

    /**
     * Create sub container scope
     */
    public createScope(): Container {
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
