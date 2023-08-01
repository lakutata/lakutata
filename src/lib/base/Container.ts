import {
    createContainer,
    IDependencyInjectionContainer,
    NameAndRegistrationPair
} from '../ioc/DependencyInjectionContainer.js'
import {Resolver} from '../ioc/Resolvers.js'

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
        return await this._dic.resolve(name)
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

}
