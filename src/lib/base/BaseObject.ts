import {AsyncConstructor} from './async-constructor/AsyncConstructor.js'
import {Transient} from '../../decorators/di/Lifetime.js'
import {ObjectConstructor} from './func/ObjectConstructor.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'
import {As} from './func/As.js'
import {DevNull} from './func/DevNull.js'
import {Container, containerSymbol} from '../core/Container.js'
import {randomUUID} from 'node:crypto'
import {GetConfigurableRecordsFromInstance} from './internal/ConfigurableRecordsInjection.js'
import {GetObjectConfigurablePropertiesByPrototype} from './internal/ObjectConfiguration.js'
import {IsSymbol} from './func/IsSymbol.js'
import {GetObjectInjectItemsByPrototype, ObjectInjectionMap} from './internal/ObjectInjection.js'
import {IConstructor} from '../../interfaces/IConstructor.js'

@Transient()
export class BaseObject extends AsyncConstructor {

    readonly #container: Container

    #objectId: string = randomUUID()

    /**
     * Load configurable records
     * @private
     */
    #loadConfigurableRecords(): void {
        const configurableRecords: Record<string, any> = GetConfigurableRecordsFromInstance(this)
        GetObjectConfigurablePropertiesByPrototype(this).forEach((propertyKey: string | symbol): void => {
            if (IsSymbol(propertyKey)) return
            this[propertyKey] = configurableRecords[As<string>(propertyKey)]
        })
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
            injectionPromises.push(new Promise((resolve, reject) => {
                this.#container.get(registration).then(injectObject => {
                    this[propertyKey] = injectObject
                    return resolve()
                }).catch(reject)
            }))
        })
        await Promise.all(injectionPromises)
    }

    /**
     * Constructor
     * @param cradleProxy
     */
    constructor(cradleProxy: Record<string | symbol, any>) {
        super(async (): Promise<void> => {
            //Apply object injection
            await this.#applyInjection()
            //Load and apply configurable records to current object's property
            this.#loadConfigurableRecords()

            //Ensure property "then" not in subclass
            const thenablePropertyDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(this, 'then')
            if (thenablePropertyDescriptor) Object.defineProperty(this, 'then', {enumerable: false})
            //Execute init functions
            await this.__init()
            await this.init()
        })
        this.#container = new Container(cradleProxy[containerSymbol])
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
     * Internal initialize function
     * @protected
     */
    protected async __init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Internal destroy function
     * @protected
     */
    protected async __destroy(): Promise<void> {
        await this.#container.destroy()
    }

    /**
     * Initialize function
     * @protected
     */
    protected async init(): Promise<void> {
        //To be override in child class
    }

    /**
     * Destroy function
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
    protected async getObject<T extends BaseObject>(constructor: IConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
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
    protected async getObject<T extends BaseObject>(nameOrConstructor: string | symbol | IConstructor<T>, configurableRecords?: Record<string, any>): Promise<T>
    protected async getObject<T extends BaseObject>(inp: string | symbol | IConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return await this.#container.get(inp, configurableRecords)
    }

    /**
     * Instantiate an instance of a base object class by injecting dependencies, but without registering it in the container
     * @param constructor
     * @param configurableRecords
     * @protected
     */
    protected async instantiateObject<T extends BaseObject>(constructor: IConstructor<T>, configurableRecords: Record<string, any> = {}): Promise<T> {
        return this.#container.build(constructor, configurableRecords)
    }

    /**
     * Unique object id
     */
    public objectId(): string {
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
    public hasProperty(propertyKey: string): boolean {
        return this.propertyNames().includes(propertyKey)
    }

    public propertyNames(): string[] {
        return Object.getOwnPropertyNames(this)
    }

    /**
     * Is object has method
     * @param name
     */
    public hasMethod(name: string): boolean {
        const propertyExists: boolean = this.hasProperty(name)
        if (propertyExists) return false//Method doesn't exist
        return typeof this[name] === 'function'
    }

    /**
     * Get method from object
     * @param name
     * @param throwExceptionIfNotFound
     */
    public getMethod(name: string, throwExceptionIfNotFound: boolean = false): (...args: any[]) => any | Promise<any> {
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
