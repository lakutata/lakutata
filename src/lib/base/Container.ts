import {
    createContainer,
    IDependencyInjectionContainer,
    NameAndRegistrationPair
} from '../ioc/DependencyInjectionContainer.js'
import {asClass, Resolver} from '../ioc/Resolvers.js'
import {LoadEntryCommonOptions} from '../../options/LoadEntryCommonOptions.js'
import {LoadEntryClassOptions} from '../../options/LoadEntryClassOptions.js'
import {Accept} from '../../decorators/ValidationDecorators.js'
import {Validator} from '../../Validator.js'
import {BaseObject} from './BaseObject.js'

export class Container {

    protected readonly _dic: IDependencyInjectionContainer

    constructor() {
        this._dic = createContainer()
    }

    /**
     * 获取容器内的注册项目
     * @param name
     */
    public async get<T = any>(name: string | symbol): Promise<T> {
        return await new Promise<T>((resolve, reject) => (async (): Promise<T> => this._dic.resolve(name))().then(resolve).catch(reject))
    }

    /**
     * 将注入的项目进行注册
     * @param name
     * @param registration
     */
    public register<T>(name: string | symbol, registration: Resolver<T>): this
    public register<Cradle extends object = any>(nameAndRegistrationPair: NameAndRegistrationPair<Cradle>): this
    public register(a: any, b?: any): this {
        this._dic.register(a, b)
        return this
    }

    /**
     * 载入注入项目
     * @param options
     */
    @Accept(Validator.Object().pattern(Validator.String(), Validator.Alternatives().try(LoadEntryCommonOptions.schema(), LoadEntryClassOptions.schema())))
    public async load<T extends BaseObject>(options: Record<string, LoadEntryCommonOptions | LoadEntryClassOptions<T>>): Promise<void> {
        const xx: Record<string, any> = {
            './*.js': {lifetime: ''}
        }
    }

}
