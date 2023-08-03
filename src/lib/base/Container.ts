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
import {As, IsGlobString, RandomString} from '../../Utilities.js'
import fastGlob from 'fast-glob'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT,
    DI_TARGET_CONSTRUCTOR_UNIQUE_MARK
} from '../../constants/MetadataKey.js'
import {InvalidGlobStringException} from '../../exceptions/InvalidGlobStringException.js'
import objectHash from 'object-hash'

export class Container {

    protected readonly _dic: IDependencyInjectionContainer

    constructor(parent?: Container) {
        this._dic = createContainer({injectionMode: 'PROXY'}, parent?._dic)
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
            this.assignConfigToInjectConstructorMetadata<T>(inheritFromBaseObjectClass, options.config)
            pairs[this.stringifyGlobImportConstructor(inheritFromBaseObjectClass)] = asClass(inheritFromBaseObjectClass, {
                lifetime: options.lifetime,
                dispose: (instance: T) => instance.getMethod('destroy', false)()
            })
        })
        return pairs
    }

    /**
     * 将配置对象加载至注入项的构造函数元数据中
     * @param constructor
     * @param config
     * @protected
     */
    protected assignConfigToInjectConstructorMetadata<T extends BaseObject>(constructor: IConstructor<T>, config?: Record<string, any>): void {
        if (!config) return
        Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT, config, constructor)
    }

    /**
     * 将构造函数转换为字符串
     * @param constructor
     * @protected
     */
    protected stringifyGlobImportConstructor<T extends BaseObject>(constructor: IConstructor<T>): string {
        const constructorRecord: Record<string, string> = {
            globImport: 'yes',
            name: constructor.name,
            string: constructor.toString()
        }
        if (!Reflect.hasOwnMetadata(DI_TARGET_CONSTRUCTOR_UNIQUE_MARK, constructor)) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_UNIQUE_MARK, RandomString(32), constructor)
        constructorRecord.uniqueMark = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_UNIQUE_MARK, constructor)
        return objectHash(constructorRecord).toString()
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
        const name: string = typeof inp === 'string' ? inp : this.stringifyGlobImportConstructor(inp)
        return await new Promise<T>((resolve, reject) => (async (): Promise<T> => this._dic.resolve(name))().then(resolve).catch(reject))
    }

    /**
     * 载入注入项目
     * @param options
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Alternatives().try(LoadEntryClassOptions.schema(), LoadEntryCommonOptions.schema())))
    public async load<T extends BaseObject>(options: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>): Promise<void> {
        let pairs: NameAndRegistrationPair<any> = {}
        for (const key in options) {
            const entryOptions: LoadEntryCommonOptions | LoadEntryClassOptions<T> = options[key]
            if (LoadEntryClassOptions.isValid(entryOptions)) {
                this.assignConfigToInjectConstructorMetadata<T>(As<LoadEntryClassOptions<T>>(entryOptions).class, entryOptions.config)
                pairs[key] = asClass(As<LoadEntryClassOptions<T>>(entryOptions).class, {
                    lifetime: entryOptions.lifetime,
                    dispose: (instance: T) => instance.getMethod('destroy', false)()
                })
            } else {
                pairs = {...pairs, ...(await this.getEntryConstructorsByGlob<T>(key, entryOptions))}
            }
        }
        this._dic.register(pairs)
    }

    /**
     * 以当前容器为父容器，创建一个作用域容器
     */
    public createScope(): Container {
        return new Container(this)
    }

    /**
     * 销毁当前容器
     */
    public async destroy(): Promise<void> {
        await this._dic.dispose()
    }
}
