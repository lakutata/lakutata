import {IConstructor} from '../../interfaces/IConstructor'
import {
    As,
    ConfigureObjectProperties, MergeSet, ParentConstructor, RandomString, SetToArray,
    ThrowIntoBlackHole, UniqueArray
} from '../../Helper'
import {
    DI_CONTAINER_CREATOR_CONSTRUCTOR,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT,
    DI_TARGET_CONSTRUCTOR_INJECTS,
    OBJECT_INIT_MARK,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY,
    DTO_CLASS,
    DTO_SCHEMAS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT_NAME,
    DI_CONTAINER_INJECT_PROPERTIES,
    DI_CONTAINER_INJECT_IS_MODULE_GETTER,
    DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS,
    DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER,
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER,
    DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY,
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY,
    DI_TARGET_CONSTRUCTOR_LIFETIME,
    DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK,
    DI_TARGET_INSTANCE_CONFIGURABLE_OBJECT
} from '../../constants/MetadataKey'
import {MethodNotFoundException} from '../../exceptions/MethodNotFoundException'
import {ConfigurableOptions, Lifetime} from '../../decorators/DependencyInjectionDecorators'
import {Schema, Validator} from '../../exports/Validator'
import {defaultValidationOptions} from '../../constants/DefaultValue'
import {InvalidConfigurableValueException} from '../../exceptions/InvalidConfigurableValueException'
import {InvalidValueException} from '../../exceptions/validation/InvalidValueException'
import {AsyncConstructor} from './async-constructor/AsyncConstructor'
import {InjectionProperties} from '../../types/InjectionProperties'
import {SHA256} from '../../Hash'

const internalPropertyNameRegExp: RegExp = new RegExp('__\\$\\$\\$[a-zA-Z0-9~!@#$%^&*()_+\\[\\]\\{\\},./\\\\<>?|\\-\\*]+\\$\\$\\$__')

/**
 * 快速生成对象ID
 * @param e
 * @constructor
 */
function ObjectId(e?: number) {
    return e
        ? ((e ^ 16 * Math.random()) >> (e / 4)).toString(16)
        : ([1e7] as any + -1e3 + -4e3 + -8e3 + -1e11)
            .replace(/[018]/g, ObjectId)
}

/**
 * 基础对象基类
 */
@(() => {
    return <TFunction extends IConstructor<any>>(target: TFunction): TFunction => {
        const nonceStr: string = RandomString(16)
        Reflect.defineMetadata(DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY, SHA256(`APP_GETTER_KEY_${nonceStr}`).toString(), target)
        Reflect.defineMetadata(DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY, SHA256(`MODULE_GETTER_KEY_${nonceStr}`).toString(), target)
        return target
    }
})()
@Lifetime('TRANSIENT', false)
export class BaseObject extends AsyncConstructor {

    /**
     * Get instance's class name
     */
    public get className(): string {
        return this.constructor.name
    }

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(async (): Promise<void> => {
            if (Reflect.getMetadata(DI_CONTAINER_CREATOR_CONSTRUCTOR, properties.constructor) || Reflect.getOwnMetadata(DI_CONTAINER_INJECT_PROPERTIES, properties)) {
                //对Inject修饰器所修饰的属性进行数据注入
                const resolveInjectPromises: Promise<void>[] = []
                const injectMappingMap: Map<string, string> | undefined = Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, this.constructor)
                injectMappingMap?.forEach((injectKey: string, propertyKey: string): void => {
                    if (!Reflect.getOwnPropertyDescriptor(properties, injectKey)) return properties[injectKey]
                    Object.keys(properties).forEach((injectPropertyKey: string): void => {
                        if (injectPropertyKey === injectKey) {
                            resolveInjectPromises
                                .push(new Promise((resolve, reject) =>
                                        (async (): Promise<any> => properties[injectPropertyKey])()
                                            .then(injectItem => resolve(this.setProperty(propertyKey, Reflect.getOwnMetadata(DI_CONTAINER_INJECT_IS_MODULE_GETTER, injectItem) ? injectItem() : injectItem)))
                                            .catch(reject)
                                    )
                                )
                        }
                    })
                })
                //注入特殊项目（实例所在模块实例、应用程序实例）
                const APP_GETTER_KEY: string = Reflect.getMetadata(DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY, BaseObject)
                const MODULE_GETTER_KEY: string = Reflect.getMetadata(DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY, BaseObject)
                if (Object.keys(properties).includes(APP_GETTER_KEY) && Object.keys(properties).includes(MODULE_GETTER_KEY)) {
                    const specialInjectMappingMap: Map<string, Symbol> | undefined = Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS, this.constructor)
                    const moduleGetter = properties[MODULE_GETTER_KEY]
                    const appGetter = properties[APP_GETTER_KEY]
                    specialInjectMappingMap?.forEach((injectKey: Symbol, propertyKey: string): void => {
                        if (Reflect.getMetadata(DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER, moduleGetter) && injectKey === DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER) {
                            resolveInjectPromises
                                .push(new Promise((resolve, reject) =>
                                        (async (): Promise<any> => moduleGetter)()
                                            .then(getModule => resolve(this.setProperty(propertyKey, getModule())))
                                            .catch(reject)
                                    )
                                )
                        }
                        if (Reflect.getMetadata(DI_CONTAINER_SPECIAL_INJECT_APP_GETTER, appGetter) && injectKey === DI_CONTAINER_SPECIAL_INJECT_APP_GETTER) {
                            resolveInjectPromises
                                .push(new Promise((resolve, reject) =>
                                        (async (): Promise<any> => appGetter)()
                                            .then(getApp => resolve(this.setProperty(propertyKey, getApp())))
                                            .catch(reject)
                                    )
                                )
                        }
                    })
                }
                await Promise.all(resolveInjectPromises)
            } else {
                ConfigureObjectProperties(this, properties ? properties : {})
            }
            //对Configurable所修饰的对象进行数据注入
            const constructorConfigurableObject: Record<string, any> | undefined = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT, this.constructor, Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT_NAME, this))
            const instanceConfigurableObject: Record<string, any> | undefined = Reflect.getOwnMetadata(DI_TARGET_INSTANCE_CONFIGURABLE_OBJECT, this)
            const config: Record<string, any> = Object.assign({}, constructorConfigurableObject ? constructorConfigurableObject : {}, instanceConfigurableObject ? instanceConfigurableObject : {})
            if (config) {
                const configurableOptionsMap: Map<string, ConfigurableOptions> = As<Map<string, ConfigurableOptions> | undefined>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, this.constructor)) ? As<Map<string, ConfigurableOptions>>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, this.constructor)) : new Map()
                let configurableItems: Set<string> | undefined = Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, this.constructor)
                let constructor: typeof this.constructor | null = this.constructor
                while (constructor = ParentConstructor(constructor)) {
                    const parentConfigurableItems: Set<string> | undefined = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, constructor)
                    if (parentConfigurableItems) configurableItems = MergeSet(configurableItems ? configurableItems : new Set<string>(), parentConfigurableItems)
                    As<Map<string, ConfigurableOptions> | undefined>(Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS, constructor))?.forEach((options: ConfigurableOptions, propertyKey: string): void => {
                        if (!configurableOptionsMap.has(propertyKey)) configurableOptionsMap.set(propertyKey, options)
                    })
                }
                const configurableInitValueMap: Map<string, any> = new Map()
                configurableItems?.forEach((configurablePropertyKey: string) => configurableInitValueMap.set(configurablePropertyKey, this[configurablePropertyKey]))
                configurableOptionsMap.forEach((options: ConfigurableOptions, propertyKey: string): void => {
                    configurableInitValueMap.set(propertyKey, this[propertyKey])
                    const originDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(this, propertyKey)
                    const originSetter: ((val: any) => void) | undefined = originDescriptor?.set?.bind(this)
                    const originGetter: (() => any) | undefined = originDescriptor?.get?.bind(this)
                    Object.defineProperty(this, propertyKey, {
                        configurable: true,
                        set: (value: any): void => {
                            if (options.accept) {
                                const schema: Schema = Reflect.hasMetadata(DTO_CLASS, options.accept) ? Validator.Object(Reflect.getMetadata(DTO_SCHEMAS, options.accept)) : As<Schema>(options.accept)
                                options.acceptOptions = options.acceptOptions ? Object.assign({}, defaultValidationOptions, options.acceptOptions) : defaultValidationOptions
                                try {
                                    value = Validator.validate(value, schema, options.acceptOptions)
                                } catch (e) {
                                    throw new InvalidConfigurableValueException('{className}\'s property "{propertyKey}" validate error: {message}', {
                                        className: this.constructor.name,
                                        propertyKey: propertyKey,
                                        message: As<InvalidValueException>(e).errMsg
                                    })
                                }
                            }
                            if (originSetter) originSetter(value)
                            Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY, value, this, propertyKey)
                            if (options.onSet) options.onSet.call(this, value)
                        },
                        get: (): any => {
                            let value: any = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY, this, propertyKey)
                            if (originGetter) value = originGetter()
                            if (options.onGet) options.onGet.call(this, value)
                            return value
                        }
                    })
                })
                if (configurableItems) configurableItems.forEach((propertyKey: string): void => this[propertyKey] = Object.hasOwn(config, propertyKey) ? config[propertyKey] : configurableInitValueMap.get(propertyKey))
            }
            delete this['then']//确保在子类中不会获取到“then”的属性
            await this.__init()
            if (!this.getInternalProperty('preventDefaultInit')) await this.init()
            Reflect.defineMetadata(OBJECT_INIT_MARK, true, this)
        })
        this.setInternalProperty('type', 'BaseObject')
        this.setInternalProperty('uniqueObjectId', ObjectId())
    }

    /**
     * Convert property name to internal property name
     * @param propertyName
     * @private
     */
    private propertyNameToInternalPropertyName(propertyName: string): string {
        return `__$$$${propertyName}$$$__`
    }

    /**
     * Internal destroy function
     * @protected
     */
    protected async __destroy(): Promise<void> {
        //To be override in child class
    }

    /**
     * Internal initialize function
     * @protected
     */
    protected async __init(): Promise<void> {
        //To be override in child class
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
     * Configurable propertyKeys
     * @protected
     */
    protected async __getConfigurableProperties(): Promise<string[]> {
        const propertyNames: string[] = []
        let constructor: IConstructor<any> | null = <IConstructor<any>>(this.constructor)
        while (constructor) {
            if (Reflect.hasMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, constructor)) {
                SetToArray(As<Set<string>>(Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS, constructor))).forEach((p: string) => propertyNames.push(p))
            }
            constructor = ParentConstructor(constructor)
        }
        return UniqueArray(propertyNames)
    }

    /**
     * Set internal property
     * @param propertyKey
     * @param value
     * @protected
     */
    protected setInternalProperty(propertyKey: string, value: any): void {
        this.setProperty(this.propertyNameToInternalPropertyName(propertyKey), value)
    }

    /**
     * Get internal property
     * @param propertyKey
     * @param defaultValue
     * @protected
     */
    protected getInternalProperty<T = any>(propertyKey: string, defaultValue?: T): T {
        if (this.hasInternalProperty(propertyKey)) return As<T>(this[this.propertyNameToInternalPropertyName(propertyKey)])
        return As<T>(defaultValue)
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

    /**
     * Is object has internal property
     * @param propertyKey
     */
    public hasInternalProperty(propertyKey: string): boolean {
        return this.internalPropertyNames().includes(this.propertyNameToInternalPropertyName(propertyKey))
    }

    /**
     * Is object has method
     * @param name
     */
    public hasMethod(name: string): boolean {
        const propertyExists: boolean = this.hasProperty(name)
        if (propertyExists) return false//方法不存在于属性列表中
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
            return (...args: any[]): void => ThrowIntoBlackHole(...args)
        }
    }

    /**
     * Get property names
     * Exclude internal property names
     */
    public propertyNames(): string[] {
        return Object.getOwnPropertyNames(this).filter(propertyName => !internalPropertyNameRegExp.test(propertyName))
    }

    /**
     * Get internal property names
     * Exclude non-internal property names
     */
    public internalPropertyNames(): string[] {
        return Object.getOwnPropertyNames(this).filter(propertyName => internalPropertyNameRegExp.test(propertyName))
    }

    /**
     * Return class's lifetime mode
     */
    protected static get __LIFETIME(): 'SINGLETON' | 'TRANSIENT' | 'SCOPED' {
        return Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME, this)
    }

    /**
     * Return class's lifetime mode is locked
     */
    protected static get __LIFETIME_LOCKED(): boolean {
        return !!Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK, this)
    }

    /**
     * Return class's name
     */
    public static get className(): string {
        return this.name
    }

}
