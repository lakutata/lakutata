import {AsyncConstructor} from 'async-constructor'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {As, ConfigureObjectProperties} from '../../Utilities.js'
import {
    DI_CONTAINER_CREATOR_CONSTRUCTOR, DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT,
    DI_TARGET_CONSTRUCTOR_INJECTS
} from '../../constants/MetadataKey.js'

export class BaseObject extends AsyncConstructor {
    /**
     * Constructor
     * @param properties
     */
    constructor(properties?: Record<string, any>) {
        super(async (): Promise<void> => {
            if (properties) {
                if (Reflect.getMetadata(DI_CONTAINER_CREATOR_CONSTRUCTOR, properties.constructor)) {
                    const resolveInjectPromises: Promise<void>[] = []
                    const injectMappingMap: Map<string, string> | undefined = Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, this.constructor)
                    injectMappingMap?.forEach((injectKey: string, propertyKey: string): void => {
                        if (!Reflect.getOwnPropertyDescriptor(properties, injectKey)) return properties[injectKey]
                        Object.keys(properties).forEach((injectPropertyKey: string): void => {
                            if (injectPropertyKey === injectKey && this.hasProperty(propertyKey)) {
                                resolveInjectPromises.push(new Promise((resolve, reject) => (async (): Promise<any> => properties[injectPropertyKey])().then(injectItem => resolve(this.setProperty(propertyKey, injectItem))).catch(reject)))
                            }
                        })
                    })
                    await Promise.all(resolveInjectPromises)
                } else {
                    ConfigureObjectProperties(this, properties ? properties : {})
                }
            }
            const config: Record<string, any> | undefined = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT, this.constructor)
            if (config) {
                const configurableItems: Set<string> | undefined = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, this.constructor)
                if (configurableItems) {
                    configurableItems.forEach((propertyKey: string): void => this[propertyKey] = Object.hasOwn(config, propertyKey) ? config[propertyKey] : this[propertyKey])
                }
            }
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
