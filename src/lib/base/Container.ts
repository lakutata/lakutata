import {
    createContainer,
    IDependencyInjectionContainer,
    NameAndRegistrationPair
} from '../ioc/DependencyInjectionContainer.js'
import {asClass} from '../ioc/Resolvers.js'
import {LoadEntryCommonOptions} from '../../options/LoadEntryCommonOptions.js'
import {LoadEntryClassOptions} from '../../options/LoadEntryClassOptions.js'
import {Accept} from '../../decorators/ValidationDecorators.js'
import {Validator} from '../../Validator.js'
import {BaseObject} from './BaseObject.js'
import {As, IsGlobString, isPromise, RandomString} from '../../Utilities.js'
import fastGlob from 'fast-glob'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {
    CONTROLLER_ACTION_MAP,
    CONTROLLER_CONSTRUCTOR_MARK,
    DI_CONTAINER_INJECT_IS_MODULE_GETTER,
    DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY,
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER,
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY,
    DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT,
    DI_TARGET_CONSTRUCTOR_FINGERPRINT, DI_TARGET_INSTANCE_CONFIGURABLE_OBJECT
} from '../../constants/MetadataKey.js'
import {InvalidGlobStringException} from '../../exceptions/InvalidGlobStringException.js'
import objectHash from 'object-hash'
import {Module} from './Module.js'
import {Application} from '../Application.js'
import {
    DynamicRegisterControllerNotAllowException
} from '../../exceptions/controller/DynamicRegisterControllerNotAllowException.js'
import {ControllerActionMapItem} from '../../types/ControllerActionMapItem.js'
import {
    DuplicateControllerActionPatternException
} from '../../exceptions/controller/DuplicateControllerActionPatternException.js'
import {IPatRun} from '../../interfaces/IPatRun.js'
import {Controller} from './Controller.js'

export class Container<T extends Module = Module> {

    protected readonly __$$module?: Module

    protected readonly __$$parent?: Container

    protected readonly __$$dic: IDependencyInjectionContainer

    protected readonly __$$additionalPropertyMap: Map<string, any> = new Map()

    protected readonly __$controllerActionMap: Map<string, ControllerActionMapItem> = new Map()

    constructor(module?: T, parent?: Container) {
        this.__$$module = module
        this.__$$parent = parent
        this.__$$dic = createContainer({injectionMode: 'PROXY'}, this.__$$parent?.__$$dic)
        if (this.__$$module) this.registerModule(this.__$$module)
    }

    /**
     * 加载额外的信息至注入器
     * @protected
     */
    protected additionalPropertiesInjector(): Record<string, any> {
        const parentAdditionalProperties: Record<string, any> | undefined = this.__$$parent?.additionalPropertiesInjector()
        const additionalProperties: Record<string, any> = parentAdditionalProperties ? parentAdditionalProperties : {}
        this.__$$additionalPropertyMap.forEach((value, key) => additionalProperties[key] = value)
        return additionalProperties
    }

    /**
     * 容器内对象销毁处理方法
     * @param instance
     * @protected
     */
    protected async disposer<T extends BaseObject>(instance: T): Promise<void> {
        await instance.getMethod('__destroy', false)()
        await instance.getMethod('destroy', false)()
    }

    /**
     * 将构造函数转换为字符串
     * @param constructor
     */
    public static stringifyConstructor<T extends BaseObject>(constructor: IConstructor<T>): string {
        const constructorRecord: Record<string, string> = {
            name: constructor.name,
            string: constructor.toString()
        }
        if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_FINGERPRINT, constructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_FINGERPRINT, RandomString(32), constructor)
        constructorRecord.fingerprint = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_FINGERPRINT, constructor)
        return `${objectHash(constructorRecord).toString()}_$$${constructor.name}`
    }

    /**
     * 判断是否Controller类
     * @param constructor
     * @protected
     */
    protected isControllerConstructor(constructor: IConstructor<any>): boolean {
        return Reflect.hasMetadata(CONTROLLER_CONSTRUCTOR_MARK, constructor)
    }

    /**
     * 将Controller注册至模块
     * @param constructor
     * @protected
     */
    protected registerControllerToModule(constructor: IConstructor<any>): void {
        if (this.__$$module && Reflect.hasOwnMetadata(CONTROLLER_ACTION_MAP, constructor)) {
            const items = As<Map<string, ControllerActionMapItem>>(Reflect.getOwnMetadata(CONTROLLER_ACTION_MAP, constructor)).values()
            for (const item of items) {
                let isNewPattern: boolean = true
                if (this.__$controllerActionMap.has(item.patternHash)) {
                    //在同个控制器类的同个方法上可以允许相同的pattern，否则则报错
                    const isSameController: boolean = this.__$controllerActionMap.get(item.patternHash)?.class === item.class
                    const isSameMethod: boolean = this.__$controllerActionMap.get(item.patternHash)?.method === item.method
                    if (!isSameController || !isSameMethod) throw new DuplicateControllerActionPatternException('The pattern of controller action "{a}" conflicts with "{b}"', {
                        a: `${this.__$controllerActionMap.get(item.patternHash)!.class.name}.${this.__$controllerActionMap.get(item.patternHash)!.method.toString()}`,
                        b: `${item.class.name}.${item.method.toString()}`
                    })
                    isNewPattern = false
                }
                if (isNewPattern) {
                    this.__$controllerActionMap.set(item.patternHash, item)
                    //在模块对象上的patternManager进行注册
                    As<IPatRun>(this.__$$module.getProperty('__$$patternManager'))?.add(item.pattern, async (subject: Record<string, any>, configurableParams: Record<string, any> = {}): Promise<any> => {
                        const controllerRuntimeScope: Container = this.createScope(this.__$$module)
                        const controller: Controller = await controllerRuntimeScope.get(item.class, configurableParams)
                        const result: any = await controller[item.method](subject)
                        setImmediate(() => controllerRuntimeScope.destroy())
                        return result
                    })
                }
            }
        }
    }

    /**
     * 根据Glob注册
     * @param glob
     * @param options
     * @protected
     */
    protected async getEntryConstructorsByGlob<T extends BaseObject>(glob: string, options: LoadEntryCommonOptions): Promise<NameAndRegistrationPair<any>> {
        if (!IsGlobString(glob)) throw new InvalidGlobStringException('"{0}" is not valid glob string', [glob])
        const matchedFilenames: string[] = await fastGlob(glob)
        const inheritFromBaseObjectClasses: IConstructor<T>[] = []
        const loadEntryByGlobPromises: Promise<void>[] = []
        matchedFilenames.forEach(matchedFilename => {
            loadEntryByGlobPromises.push(new Promise((resolve, reject) => import(matchedFilename).then(moduleExportObject => {
                const exports: any[] = Object.values(moduleExportObject)
                inheritFromBaseObjectClasses.push(...exports.filter(exportItem => exportItem.prototype instanceof BaseObject))
                return resolve()
            }).catch(reject)))
        })
        await Promise.all(loadEntryByGlobPromises)
        const pairs: NameAndRegistrationPair<any> = {}
        inheritFromBaseObjectClasses.forEach((inheritFromBaseObjectClass: IConstructor<T>): void => {
            const name: string = Container.stringifyConstructor(inheritFromBaseObjectClass)
            this.assignConfigToInjectConstructorMetadata<T>(name, inheritFromBaseObjectClass, (() => {
                const {class: cls, ...configs} = As<Record<string, any>>(options)
                return configs
            })())
            pairs[name] = asClass(inheritFromBaseObjectClass, {
                lifetime: options.lifetime,
                dispose: (instance: T) => this.disposer(instance),
                injector: () => this.additionalPropertiesInjector()
            })
        })
        return pairs
    }

    /**
     * 将配置对象加载至注入项的构造函数元数据中
     * @param name
     * @param constructor
     * @param config
     * @protected
     */
    protected assignConfigToInjectConstructorMetadata<T extends BaseObject>(name: string, constructor: IConstructor<T>, config?: Record<string, any>): void {
        if (this.isControllerConstructor(constructor) && this.__$$module) this.registerControllerToModule(constructor)
        if (!config) return
        Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT, config, constructor, name)
    }

    /**
     * 向容器中注册模块实例
     * @param instance
     * @protected
     */
    protected registerModule<T extends Module>(instance: T): void {
        const name: string = Container.stringifyConstructor(As<IConstructor<T>>(instance.constructor))
        const _$$moduleGetter: () => T = () => instance
        Reflect.defineMetadata(DI_CONTAINER_INJECT_IS_MODULE_GETTER, true, _$$moduleGetter)
        Reflect.defineMetadata(DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER, true, _$$moduleGetter)
        this.__$$additionalPropertyMap.set(name, _$$moduleGetter)
        this.__$$additionalPropertyMap.set(Reflect.getMetadata(DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY, BaseObject), _$$moduleGetter)
        if (instance instanceof Application) {
            Reflect.defineMetadata(DI_CONTAINER_SPECIAL_INJECT_APP_GETTER, true, _$$moduleGetter)
            this.__$$additionalPropertyMap.set(Reflect.getMetadata(DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY, BaseObject), _$$moduleGetter)
        }
    }

    /**
     * 载入注入项目
     * @param options
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Alternatives().try(LoadEntryClassOptions.schema(), LoadEntryCommonOptions.schema())))
    public async load<T extends BaseObject>(options: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>): Promise<void> {
        const loadPairPromises: Promise<NameAndRegistrationPair<any>>[] = []
        for (const key in options) {
            loadPairPromises.push(new Promise((resolve, reject) => {
                const entryOptions: LoadEntryCommonOptions | LoadEntryClassOptions<T> = options[key]
                try {
                    if (!LoadEntryClassOptions.isValid(entryOptions)) return this.getEntryConstructorsByGlob<T>(key, entryOptions).then(resolve).catch(reject)
                    this.assignConfigToInjectConstructorMetadata<T>(key, As<LoadEntryClassOptions<T>>(entryOptions).class, (() => {
                        const {class: cls, ...configs} = As<Record<string, any>>(entryOptions)
                        return configs
                    })())
                    const _pairs: NameAndRegistrationPair<any> = {}
                    _pairs[key] = asClass(As<LoadEntryClassOptions<T>>(entryOptions).class, {
                        lifetime: (As<LoadEntryClassOptions<T>>(entryOptions).class).__LIFETIME,
                        dispose: (instance: T) => this.disposer(instance),
                        injector: () => this.additionalPropertiesInjector()
                    })
                    return resolve(_pairs)
                } catch (e) {
                    return reject(e)
                }
            }))
        }
        (await Promise.all(loadPairPromises)).forEach((pair: NameAndRegistrationPair<any>) => this.__$$dic.register(pair))
    }

    /**
     * 通过名称获取容器内的注册项目
     * @param name 注册项目的名称
     * @param configurableParams 获取时传入的配置参数对象，必须为在注册项目内使用了@Configurable()修饰器进行修饰的字段
     */
    public async get<T extends BaseObject>(name: string, configurableParams?: Record<string, any>): Promise<T>
    /**
     * 通过构造函数获取容器内的注册项目
     * @param constructor 注册项目的构造函数
     * @param configurableParams 获取时传入的配置参数对象，必须为在注册项目内使用了@Configurable()修饰器进行修饰的字段
     */
    public async get<T extends BaseObject>(constructor: IConstructor<T>, configurableParams?: Record<string, any>): Promise<T>
    public async get<T extends BaseObject>(inp: string | IConstructor<T>, configurableParams?: Record<string, any>): Promise<T> {
        const name: string = typeof inp === 'string' ? inp : Container.stringifyConstructor(inp)
        const resolved: T | Promise<T> = this.__$$dic.resolve(name)
        //在取得实例时进行实例上的元数据注入，将附加的可配置项注入至对象中，在该阶段，对象根据可配置对象进行自身的配置过程尚未开始
        if (typeof resolved === 'object' || typeof resolved === 'function') Reflect.defineMetadata(DI_TARGET_INSTANCE_CONFIGURABLE_OBJECT, configurableParams ? configurableParams : {}, resolved)
        return isPromise(resolved) ? await resolved : resolved
    }

    /**
     * 注入指定字符串名称的对象
     * @param name
     * @param options
     */
    public async set<T extends BaseObject>(name: string, options: LoadEntryClassOptions<T>): Promise<string>
    /**
     * 注入非指定字符串名称的构造函数对象
     * @param constructor
     * @param config
     */
    public async set<T extends BaseObject>(constructor: IConstructor<T>, config?: Record<string, any>): Promise<string>
    public async set<T extends BaseObject>(inp: string | IConstructor<T>, b?: LoadEntryClassOptions<T> | Record<string, any>): Promise<string> {
        const loadOptions: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>> = {}
        let name: string
        if (typeof inp === 'string') {
            const options: LoadEntryClassOptions<T> = As<LoadEntryClassOptions<T>>(LoadEntryClassOptions.validate(b))
            name = inp
            loadOptions[inp] = options
        } else {
            const config: Record<string, any> = b ? b : {}
            name = Container.stringifyConstructor(inp)
            loadOptions[name] = {class: inp, ...config}
        }
        if (loadOptions.class && this.isControllerConstructor(As<IConstructor<T>>(loadOptions.class)))
            throw new DynamicRegisterControllerNotAllowException('Dynamic registration of controllers is not allowed during runtime. Attempting to dynamically register controller class "{className}"', {
                className: As<IConstructor<T>>(loadOptions.class).name
            })
        await this.load(loadOptions)
        return name
    }

    /**
     * 注入并创建指定字符串名称的对象
     * @param name
     * @param options
     */
    public async createObject<T extends BaseObject>(name: string, options: LoadEntryClassOptions<T>): Promise<T>
    /**
     * 注入并创建非指定字符串名称的构造函数对象
     * @param constructor
     * @param config
     */
    public async createObject<T extends BaseObject>(constructor: IConstructor<T>, config?: Record<string, any>): Promise<T>
    public async createObject<T extends BaseObject>(inp: string | IConstructor<T>, b?: LoadEntryClassOptions<T> | Record<string, any>): Promise<T> {
        return await this.get<T>(await this.set(As<any>(inp), b))
    }

    /**
     * 以当前容器为父容器，创建一个作用域容器
     * @param module
     */
    public createScope(module?: Module): Container {
        return new Container(module ? module : this.__$$module, this)
    }

    /**
     * 销毁当前容器
     */
    public async destroy(): Promise<void> {
        await this.__$$dic.dispose()
        this.__$controllerActionMap.clear()
        this.__$$additionalPropertyMap.clear()
    }
}
