import {AsyncConstructor} from 'async-constructor'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {As, ConfigureObjectProperties} from '../../Utilities.js'

export class BaseObject extends AsyncConstructor {
    /**
     * Constructor
     * @param properties
     */
    constructor(properties?: Record<string, any>) {
        super(async (): Promise<void> => {
            ConfigureObjectProperties(this, properties ? properties : {})
            await this.init()
        })
    }

    /**
     * Initialize function
     * @protected
     */
    protected async init(): Promise<void> {
        //To be override in child class
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
     */
    public getProperty<T = any>(propertyKey: string): T {
        return As<T>(this[propertyKey])
    }

    /**
     * Is object has property
     * @param propertyKey
     */
    public hasProperty(propertyKey: string): boolean {
        return As(this).hasOwnProperty(propertyKey) || this[propertyKey] !== undefined
    }

    /**
     * Is object has method
     * @param name
     */
    public hasMethod(name: string): boolean {
        const propertyExists: boolean = this.hasProperty(name)
        if (!propertyExists) return false
        return typeof this.getProperty(name) === 'function'
    }

    /**
     * Instantiate the class
     * @param properties
     */
    public static async instantiate<T extends BaseObject>(this: IConstructor<T>, properties?: Record<string, any>): Promise<T> {
        return await As<PromiseLike<T>>(new this(properties))
    }

    /**
     * Return class's name
     */
    public static className(): string {
        return this.name
    }
}
