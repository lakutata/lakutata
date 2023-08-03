import {AsyncConstructor} from 'async-constructor'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {As, ConfigureObjectProperties, MergeSet, ParentConstructor, ThrowIntoBlackHole} from '../../Utilities.js'
import {
    DI_CONTAINER_CREATOR_CONSTRUCTOR,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT,
    DI_TARGET_CONSTRUCTOR_INJECTS,
    OBJECT_INIT_MARK, DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY
} from '../../constants/MetadataKey.js'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException.js'
import {ConfigurableOptions} from '../../decorators/DependencyInjectionDecorators.js'

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
                const configurableOptionsMap: Map<string, ConfigurableOptions> = As<Map<string, ConfigurableOptions> | undefined>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, this)) ? As<Map<string, ConfigurableOptions>>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, this.constructor)) : new Map()
                let configurableItems: Set<string> | undefined = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, this.constructor)
                let constructor: typeof this.constructor | null = this.constructor
                while (constructor = ParentConstructor(constructor)) {
                    const parentConfigurableItems: Set<string> | undefined = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, constructor)
                    if (parentConfigurableItems) configurableItems = MergeSet(configurableItems ? configurableItems : new Set<string>(), parentConfigurableItems)
                    As<Map<string, ConfigurableOptions> | undefined>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, constructor))?.forEach((options: ConfigurableOptions, propertyKey: string): void => {
                        if (!configurableOptionsMap.has(propertyKey)) configurableOptionsMap.set(propertyKey, options)
                    })
                }
                configurableOptionsMap.forEach((options: ConfigurableOptions, propertyKey: string): void => {
                    Object.defineProperty(this, propertyKey, {
                        set: (value: any): void => {
                            Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY, options.onSet ? options.onSet(value) : value, this, propertyKey)
                        },
                        get(): any {
                            const value: any = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY, this, propertyKey)
                            return options.onGet ? options.onGet(value) : value
                        }
                    })
                })
                if (configurableItems) configurableItems.forEach((propertyKey: string): void => this[propertyKey] = Object.hasOwn(config, propertyKey) ? config[propertyKey] : this[propertyKey])
            }
            await this.init()
            Reflect.defineMetadata(OBJECT_INIT_MARK, true, this)
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
     * Destroy function
     * @protected
     */
    protected async destroy(): Promise<void> {
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
     * Get method from object
     * @param name
     * @param throwExceptionIfNotFound
     */
    public getMethod(name: string, throwExceptionIfNotFound: boolean = false): (...args: any[]) => any | Promise<any> {
        if (this.hasMethod(name)) {
            return (...args: any[]) => this[name](...args)
        } else if (throwExceptionIfNotFound) {
            throw new MethodNotFoundException('Method "{methodName}" not found in "{className}"', {methodName: name, className: this.constructor.name})
        } else {
            return (...args: any[]): void => ThrowIntoBlackHole(...args)
        }
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
