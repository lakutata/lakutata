import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'
import {Container, containerSymbol, RegisterTeardownHook} from '../core/Container.js'
import {randomUUID} from 'node:crypto'
import {GetConfigurableRecordsFromInstance, GetIdFromInstance, GetRegistrationNameFromInstance} from './internal/ConfigurableRecordsInjection.js'
import {GetObjectConfigurableProperties} from './internal/ObjectConfiguration.js'
import {
    GetObjectInjectItemsByPrototype,
    InjectionTransformFunction,
    type ObjectInjectionMap
} from './internal/ObjectInjection.js'
import {SetObjectContainerGetter} from './internal/ObjectContainer.js'
import {DTO} from '../dto/DTO.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {IsSymbol} from '@lakutata/utils/IsSymbol'
import {ObjectConstructor} from '@lakutata/utils/ObjectConstructor'
import {As} from '@lakutata/utils/As'
import {DevNull} from '@lakutata/utils/DevNull'
import {DefineObjectType, GetObjectType, ObjectType, RegisterBaseObject} from './internal/ObjectType.js'
import {Module} from '../core/Module.js'
import {WhenApplicationLaunched} from './internal/ApplicationLaunch.js'
import {ReportLaunchedError} from '../foundation/LifecycleErrorReporter.js'
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
 * Lakutata object base class
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
     * Load configurable records
     * @private
     */
    async #loadConfigurableRecords(): Promise<void> {
        const configurableRecords: Record<string, any> = GetConfigurableRecordsFromInstance(this)
        const setConfigurableValuePromises: Promise<void>[] = []
        GetObjectConfigurableProperties(this).forEach((schemaAndFn, propertyKey): void => {
            if (IsSymbol(propertyKey)) return
            setConfigurableValuePromises.push(new Promise<void>((resolve, reject): void => {
                DTO.validateAsync(configurableRecords[As<string>(propertyKey)], schemaAndFn.schema, {targetName: propertyKey}).then(validatedValue => {
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
        const objectInjectionMap: ObjectInjectionMap = GetObjectInjectItemsByPrototype(this)
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
        const id: string | symbol | undefined = GetIdFromInstance(this)
        this.#objectId = id ? id : anonymousId
    }

    /**
     * Constructor
     * @param cradleProxy
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
        SetObjectContainerGetter(this, this.#container)
        //The teardown of the container may start before the teardown of the object (the teardown of its owner destroys
        //the containers of the objects first), so beforeDestroy() runs when the teardown of the container starts
        if (this.beforeDestroy !== BaseObject.prototype.beforeDestroy) {
            RegisterTeardownHook(this.#container, (): Promise<void> => this.#beforeDestroying ? Promise.resolve() : this.#runBeforeDestroy())
        }
    }

    /**
     * Run beforeDestroy() once for a teardown
     * @private
     */
    #runBeforeDestroy(): Promise<void> {
        return this.#beforeDestroying ??= (async (): Promise<void> => await this.beforeDestroy())()
    }

    /**
     * Return class's name
     */
    public static get className(): string {
        return this.name
    }

    /**
     * Get instance's class name
     */
    public get className(): string {
        return ObjectConstructor(this).name
    }

    /**
     * Internal initializer
     * @param hooks
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
                Promise.resolve(this.launched()).catch((error: unknown): void => ReportLaunchedError(error, this.className))
            } catch (error) {
                ReportLaunchedError(error, this.className)
            }
        }
        void (WhenApplicationLaunched(this) ?? Promise.resolve()).then(run)
    }

    /**
     * Make a destroyed object ready to be initialized again (reload)
     * @description Fails when the parent has been destroyed (or is being destroyed). Injected dependencies were destroyed with the object, so they are injected again
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
     * Internal destroyer
     * @param hooks
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Every teardown path (dispose, owner/scope teardown, asyncDispose) runs the same teardown only once,
        //its errors are delivered to the first caller only
        if (this.#destroying) return await this.#destroying.catch(DevNull)
        this.#state = 'destroying'
        this.#destroying = (async (): Promise<void> => {
            const errors: unknown[] = []
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
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Called once the application the object belongs to has launched (its objects are created and its bootstrap ran),
     * as the mounted hook of a Vue component: the object starts the work which needs the whole application. An object
     * created once the application has launched, or without application (in a bare container), is called right after
     * its initialization; an object destroyed before is not called, a reloaded object is called again. Its errors are
     * reported (through the logger of the application), they do not stop the application
     * @protected
     */
    protected async launched(): Promise<void> {
    }

    /**
     * Called when the teardown of the object starts, before the objects it created are destroyed (as the parent first
     * beforeDestroy of a Vue component): the object stops its work, such as receiving requests, while the objects it
     * uses are still alive. Called once per teardown, whatever starts it
     * @protected
     */
    protected async beforeDestroy(): Promise<void> {
    }

    /**
     * Destroyer, called once the objects created by the object are destroyed
     * @protected
     */
    protected async destroy(): Promise<void> {
        //To be override in child class
    }

    /**
     * Get registered object via constructor
     * @param constructor
     * @param configurableRecords
     */
    protected async getObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string
     * @param name
     * @param configurableRecords
     */
    protected async getObject<T extends BaseObject>(name: string, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via symbol
     * @param name
     * @param configurableRecords
     */
    protected async getObject<T extends BaseObject>(name: symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string or symbol
     * @param name
     * @param configurableRecords
     * @protected
     */
    protected async getObject<T extends BaseObject>(name: string | symbol, configurableRecords?: Record<string, any>): Promise<T>
    /**
     * Get registered object via string or symbol or constructor
     * @param nameOrConstructor
     * @param configurableRecords
     * @protected
     */
    protected async getObject<T extends BaseObject>(nameOrConstructor: string | symbol | IBaseObjectConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    protected async getObject<T extends BaseObject>(inp: string | symbol | IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        this.#assertNotDestroyed()
        return await this.#container.get(inp, configurableRecords)
    }

    /**
     * Instantiate an instance of a base object class by injecting dependencies, but without registering it in the container
     * @param constructor
     * @param configurableRecords
     * @protected
     */
    protected async buildObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        this.#assertNotDestroyed()
        return this.#container.build(constructor, configurableRecords)
    }

    /**
     * The options the object was created with, as they were given: the values of its configurable properties before
     * their validation, and the options which are not configurable properties
     * @protected
     */
    protected getConfigurableRecords(): Record<string, any> {
        return {...GetConfigurableRecordsFromInstance(this)}
    }

    /**
     * Get current object's parent
     * @protected
     */
    protected getParent(): BaseObject | undefined {
        return this.#container.parent?.owner()
    }

    /**
     * Get current object's parent module
     * @protected
     */
    protected getModule(): Module {
        let parent: BaseObject | undefined = this.getParent()
        while (parent && GetObjectType(As<IBaseObjectConstructor>(ObjectConstructor(parent))) !== ObjectType.Module) {
            parent = parent.getParent()
        }
        return As<Module>(parent)
    }

    /**
     * Unique object uuid
     */
    public get $uuid(): string {
        return this.#uniqueId
    }

    /**
     * Object instance id which defined in runtime
     */
    public get $id(): string | symbol {
        return this.#objectId
    }

    /**
     * Object instance symbol
     */
    public get $symbol(): symbol {
        if (Reflect.hasOwnMetadata(OSP, this)) return Reflect.getOwnMetadata(OSP, this)
        Reflect.defineMetadata(OSP, Symbol(this.$uuid), this)
        return this.$symbol
    }

    /**
     * Set object property
     * @param propertyKey
     * @param value
     */
    public setProperty(propertyKey: string, value: any): void {
        this[propertyKey] = value
    }

    /**
     * Get object's property value
     * @param propertyKey
     * @param defaultValue
     */
    public getProperty<T = any>(propertyKey: string, defaultValue?: T): T {
        if (this.hasProperty(propertyKey)) return As<T>(this[propertyKey])
        return As<T>(defaultValue)
    }

    /**
     * Is object has property
     * @param propertyKey
     */
    public hasProperty(propertyKey: string | symbol): boolean {
        return typeof propertyKey === 'string' ? this.propertyNames().includes(propertyKey) : this.propertySymbols().includes(propertyKey)
    }

    /**
     * Get own property symbols
     */
    public propertySymbols(): symbol[] {
        return Object.getOwnPropertySymbols(this)
    }

    /**
     * Get own property names
     */
    public propertyNames(): string[] {
        return Object.getOwnPropertyNames(this)
    }

    /**
     * Is object has method
     * @param name
     */
    public hasMethod(name: string | symbol): boolean {
        const propertyExists: boolean = this.hasProperty(name)
        if (propertyExists) return false //Method doesn't exist
        return typeof this[name] === 'function'
    }

    /**
     * Get method from object
     * @param name
     * @param throwExceptionIfNotFound
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
     * Dispose current object
     * @description Destroy the objects created by current object, then current object itself.
     * Calling it more than once destroys only once. Errors thrown by current object's destroyer are rethrown,
     * errors of the objects it created are reported instead.
     */
    public async dispose(): Promise<void> {
        try {
            await this[__destroy]()
        } finally {
            //A disposed cached object (singleton, scoped) is dropped, so the container creates a new one next time
            const registrationName: string | symbol | undefined = GetRegistrationNameFromInstance(this)
            if (registrationName !== undefined) this.#container.parent?.forget(registrationName, this)
        }
    }

    /**
     * Support explicit resource management: `await using object = ...`
     */
    public async [Symbol.asyncDispose](): Promise<void> {
        await this.dispose()
    }
}

RegisterBaseObject(BaseObject)
