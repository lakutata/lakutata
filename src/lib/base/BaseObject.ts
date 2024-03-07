import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {ObjectConstructor} from './func/ObjectConstructor.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'
import {As} from './func/As.js'
import {DevNull} from './func/DevNull.js'
import {Container, containerSymbol} from '../core/Container.js'
import {randomUUID} from 'node:crypto'
import {GetConfigurableRecordsFromInstance, GetIdFromInstance} from './internal/ConfigurableRecordsInjection.js'
import {GetObjectConfigurableProperties} from './internal/ObjectConfiguration.js'
import {IsSymbol} from './func/IsSymbol.js'
import {GetObjectInjectItemsByPrototype, ObjectInjectionMap} from './internal/ObjectInjection.js'
import {SetObjectContainerGetter} from './internal/ObjectContainer.js'
import {DTO} from '../core/DTO.js'
import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'

/**
 * Internal init function symbol
 */
export const __init: symbol = Symbol('__init')

/**
 * Internal destroy function symbol
 */
export const __destroy: symbol = Symbol('__destroy')

/**
 * Anonymous ID symbol, the default id value if object's id not defined in runtime
 */
export const anonymousId: symbol = Symbol('anonymous')

/**
 * Lakutata object base class
 */
@Transient()
export class BaseObject extends AsyncConstructor {

    readonly #container: Container

    #objectId: string | symbol

    #uniqueId: string = randomUUID()

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
                    return Promise.resolve(schemaAndFn.fn(validatedValue)).then(propertyValue => {
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
        objectInjectionMap.forEach((item, propertyKey: string | symbol): void => {
            //Try name first, if name not found then try constructor
            let registration: string | symbol | typeof BaseObject = item.name
            if (this.#container.has(item.name)) {
                registration = item.name
            } else if (this.#container.has(item.constructor)) {
                registration = item.constructor
            } else {
                //For autoload objects
                registration = item.constructor
            }
            injectionPromises.push(new Promise((resolve, reject): void => {
                this.#container.get(registration).then(injectObject => {
                    Reflect.set(this, propertyKey, injectObject)
                    return resolve()
                }).catch(reject)
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
        this.#container = new Container(cradleProxy[containerSymbol])
        SetObjectContainerGetter(this, this.#container)
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
        //Apply object injection
        await this.#applyInjection()
        //Load and apply configurable records to current object's property
        await this.#loadConfigurableRecords()
        //Execute hooks
        for (const hook of hooks) await hook()
        //Execute normal initializer
        await this.init()
    }

    /**
     * Internal destroyer
     * @param hooks
     * @protected
     */
    protected async [__destroy](...hooks: (() => Promise<void>)[]): Promise<void> {
        //Destroy internal container
        await this.#container.destroy()
        //Execute hooks
        for (const hook of hooks) await hook()
        //Execute normal destroyer
        await this.destroy()
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Destroyer
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
        return await this.#container.get(inp, configurableRecords)
    }

    /**
     * Instantiate an instance of a base object class by injecting dependencies, but without registering it in the container
     * @param constructor
     * @param configurableRecords
     * @protected
     */
    protected async instantiateObject<T extends BaseObject>(constructor: IBaseObjectConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return this.#container.build(constructor, configurableRecords)
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
}
