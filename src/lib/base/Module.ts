import {Component} from './Component.js'
import {Container} from './Container.js'
import {ModuleOptions} from '../../options/ModuleOptions.js'
import {Configurable, Lifetime} from '../../decorators/DependencyInjectionDecorators.js'
import {isAsyncFunction} from 'util/types'
import {As, MergeArray, UniqueArray} from '../../Utilities.js'
import {AsyncFunction} from '../../types/AsyncFunction.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {BaseObject} from './BaseObject.js'
import {Return} from '../../decorators/ValidationDecorators.js'
import {Validator} from '../../Validator.js'
import {LoadEntryCommonOptions} from '../../options/LoadEntryCommonOptions.js'
import {LoadEntryClassOptions} from '../../options/LoadEntryClassOptions.js'
import {LoadModuleOptions} from '../../options/LoadModuleOptions.js'
import {LoadComponentOptions} from '../../options/LoadComponentOptions.js'

@Lifetime('SINGLETON', true)
export class Module<TModule extends Module = any, TComponent extends Component = any, TBaseObject extends BaseObject = any> extends Component {

    @Configurable()
    protected readonly __$$options: ModuleOptions<TModule>

    @Configurable()
    protected readonly __$$parentContainer: Container

    protected readonly __$$container: Container

    /**
     * 模块初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.setProperty('__$$options', this.getProperty('__$$options', {}))
        this.setProperty('__$$container', new Container(this, this.__$$parentContainer))
        this.setProperty('__$$options', await ModuleOptions.validateAsync(this.__$$options))
        await this.__bootstrap()
    }

    /**
     * 内联载入配置对象
     * @protected
     */
    protected async configure(): Promise<ModuleOptions<TModule> | undefined> {
        //若需要内联载入配置对象则需要在子类中覆写该方法
        return
    }

    /**
     * 内联对象元素加载集合
     * @protected
     */
    @Return(Validator
        .Object()
        .pattern(
            Validator.String(),
            Validator.Alternatives().try(
                LoadEntryClassOptions.schema(),
                LoadEntryCommonOptions.schema()
            )
        )
        .optional()
        .default({}))
    protected async entries(): Promise<Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<TModule>>> {
        return {}
    }

    /**
     * 内联对象自动加载数组集合
     * @protected
     */
    @Return(Validator.Array(
        Validator
            .Alternatives()
            .try(
                Validator.Glob(),
                Validator.Class(BaseObject)
            )
    )
        .optional()
        .default([]))
    protected async autoload(): Promise<(string | IConstructor<TBaseObject>)[]> {
        return []
    }

    /**
     * 内联组件加载配置
     * @protected
     */
    @Return(Validator
        .Object()
        .pattern(Validator.String(),
            Validator.Alternatives().try(
                Validator.Class(Component),
                LoadComponentOptions.schema()
            )
        ).optional()
        .default({}))
    protected async components(): Promise<Record<string, IConstructor<TComponent> | LoadComponentOptions<TComponent>>> {
        return {}
    }

    /**
     * 内联模块加载配置
     * @protected
     */
    @Return(Validator
        .Object()
        .pattern(Validator.String(),
            Validator.Alternatives().try(
                Validator.Class(Module),
                LoadModuleOptions.schema()
            )
        ).optional()
        .default({}))
    protected async modules(): Promise<Record<string, IConstructor<TModule> | LoadModuleOptions<TModule>>> {
        return {}
    }

    /**
     * 内联启动引导配置
     * @protected
     */
    @Return(Validator.Array(
        Validator.Alternatives().try(
            Validator.String(),
            Validator.Class(BaseObject),
            Validator.AsyncFunction()
        )
    ))
    protected bootstrap<U extends Module>(): (string | IConstructor<TModule> | AsyncFunction<U, void>)[] {
        return []
    }

    /**
     * 执行启动引导
     * @protected
     */
    protected async __bootstrap(): Promise<void> {
        const configureOptions: ModuleOptions<TModule> | undefined = await this.configure()
        if (configureOptions) {
            Object.keys(configureOptions).forEach((propertyKey: string) => Object.defineProperty(this.__$$options, propertyKey, {value: configureOptions[propertyKey]}))
        }
        const entries: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<TModule>> = Object.assign(await this.entries(), this.__$$options.entries ? this.__$$options.entries : {})
        const autoload: (string | IConstructor<any>)[] = UniqueArray([...(await this.autoload()), ...(this.__$$options.autoload ? this.__$$options.autoload : [])])
        autoload.forEach((autoloadItem: string | IConstructor<any>) => {
            if (typeof autoloadItem === 'string') {
                entries[autoloadItem] = {}
            } else {
                entries[Container.stringifyConstructor(autoloadItem)] = {class: autoloadItem}
            }
        })
        const components: Record<string, IConstructor<TComponent> | LoadComponentOptions<TComponent>> = Object.assign(await this.components(), this.__$$options.components ? this.__$$options.components : {})
        const modules: Record<string, IConstructor<TModule> | LoadModuleOptions<TModule>> = Object.assign(await this.modules(), this.__$$options.modules ? this.__$$options.modules : {})
        const moduleCommonConfig: Record<string, any> = {
            __$$parentContainer: this.__$$container
        }
        Object.keys(components).forEach((componentName: string): void => {
            const componentOptions: IConstructor<TComponent> | LoadComponentOptions<TComponent> = components[componentName]
            entries[componentName] = (As<IConstructor<TComponent>>(componentOptions).prototype instanceof Component) ? {
                class: As<IConstructor<TComponent>>(componentOptions)
            } : {
                class: componentOptions.class,
                ...(() => {
                    const {class: cls, ...configs} = componentOptions
                    return configs
                })()
            }
        })
        Object.keys(modules).forEach((moduleName: string): void => {
            const moduleOptions: IConstructor<TModule> | LoadModuleOptions<TModule> = modules[moduleName]
            entries[moduleName] = (As<IConstructor<TModule>>(moduleOptions).prototype instanceof Module) ? {
                class: As<IConstructor<TModule>>(moduleOptions),
                ...moduleCommonConfig
            } : {
                class: moduleOptions.class,
                ...(() => {
                    const {class: cls, ...configs} = Object.assign(moduleOptions, moduleCommonConfig)
                    return configs
                })()
            }
        })
        await this.__$$container.load(entries)
        for (const item of MergeArray(this.bootstrap(), this.__$$options.bootstrap ? this.__$$options.bootstrap : [])) {
            if (typeof item === 'string') await this.__$$container.get(item)
            if (typeof item === 'function') isAsyncFunction(item) ? await As<AsyncFunction<ThisType<this>, void>>(item)(this) : await this.__$$container.get(As<IConstructor<BaseObject>>(item))
        }
    }

    /**
     * 模块内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        await this.__$$container.destroy()//在应用程序加载模块的时候需要初始化模块的IoC容器
        return super.__destroy()
    }

    /**
     * 模块销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        //在子类中覆写
    }

    /**
     * 按照注入名称获取对象
     * @param name
     */
    public async get<T extends BaseObject>(name: string): Promise<T>
    /**
     * 按照注入的构造函数获取对象（用于Glob加载的方式）
     * @param constructor
     */
    public async get<T extends BaseObject>(constructor: IConstructor<T>): Promise<T>
    public async get<T extends BaseObject>(inp: string | IConstructor<T>): Promise<T> {
        return await this.__$$container.get(As<any>(inp))
    }

    /**
     * 注入指定字符串名称的对象
     * @param name
     * @param options
     */
    public async set<T extends BaseObject>(name: string, options: LoadEntryClassOptions<T>): Promise<void>
    /**
     * 注入非指定字符串名称的构造函数对象
     * @param constructor
     * @param config
     */
    public async set<T extends BaseObject>(constructor: IConstructor<T>, config?: Record<string, any>): Promise<void>
    public async set<T extends BaseObject>(inp: string | IConstructor<T>, b?: LoadEntryClassOptions<T> | Record<string, any>): Promise<void> {
        await this.__$$container.set(As<any>(inp), b)
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
        return await this.__$$container.createObject<T>(As<any>(inp), b)
    }

    /**
     * 获取当前的运行环境（开发环境/正式环境）
     */
    public mode(): 'development' | 'production' {
        if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development'
        switch (process.env.NODE_ENV.toLowerCase()) {
            case 'production':
                return 'production'
            case 'development':
                return 'development'
            default: {
                process.env.NODE_ENV = 'development'
                return 'development'
            }
        }
    }
}
