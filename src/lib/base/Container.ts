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
    CONTROLLER_CONSTRUCTOR_MARK,
    DI_CONTAINER_INJECT_IS_MODULE_GETTER,
    DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY,
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER,
    DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY,
    DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT,
    DI_TARGET_CONSTRUCTOR_FINGERPRINT
} from '../../constants/MetadataKey.js'
import {InvalidGlobStringException} from '../../exceptions/InvalidGlobStringException.js'
import objectHash from 'object-hash'
import {Module} from './Module.js'
import {Application} from '../Application.js'

export class Container<T extends Module = Module> {

    protected readonly __$$module?: Module

    protected readonly __$$parent?: Container

    protected readonly __$$dic: IDependencyInjectionContainer

    protected readonly __$$additionalPropertyMap: Map<string, any> = new Map()

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
        //todo 提取控制器的元数据并向模块中写入
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
     * @param name
     */
    public async get<T extends BaseObject>(name: string): Promise<T>
    /**
     * 通过构造函数获取容器内的注册项目
     * @param constructor
     */
    public async get<T extends BaseObject>(constructor: IConstructor<T>): Promise<T>
    public async get<T extends BaseObject>(inp: string | IConstructor<T>): Promise<T> {
        const name: string = typeof inp === 'string' ? inp : Container.stringifyConstructor(inp)
        const resolved: T | Promise<T> = this.__$$dic.resolve(name)
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
    }
}
