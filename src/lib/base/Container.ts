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
import isGlob from 'is-glob'
import {As} from '../../Utilities.js'
import fastGlob from 'fast-glob'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT} from '../../constants/MetadataKey.js'

export class Container {

    protected readonly _dic: IDependencyInjectionContainer

    constructor() {
        this._dic = createContainer()
    }

    /**
     * 根据Glob注册
     * @param glob
     * @param options
     * @protected
     */
    protected async getEntryConstructorsByGlob<T extends BaseObject>(glob: string, options: LoadEntryCommonOptions): Promise<NameAndRegistrationPair<any>> {
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
            pairs[inheritFromBaseObjectClass.name] = asClass(inheritFromBaseObjectClass, {lifetime: options.lifetime})
        })
        return pairs
    }

    /**
     * 获取容器内的注册项目
     * @param name
     */
    public async get<T = any>(name: string | symbol): Promise<T> {
        return await new Promise<T>((resolve, reject) => (async (): Promise<T> => this._dic.resolve(name))().then(resolve).catch(reject))
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
                pairs[key] = asClass(As<LoadEntryClassOptions<T>>(entryOptions).class, {lifetime: entryOptions.lifetime})
            } else {
                pairs = {...pairs, ...(await this.getEntryConstructorsByGlob<T>(key, entryOptions))}
            }
        }
        this._dic.register(pairs)
    }

}
