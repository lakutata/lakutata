import {Component} from './Component.js'
import {Container} from './Container.js'
import {InjectionProperties} from '../../types/InjectionProperties.js'
import {ModuleOptions} from '../../options/ModuleOptions.js'
import {Configurable} from '../../decorators/DependencyInjectionDecorators.js'
import {isAsyncFunction} from 'util/types'
import {As} from '../../Utilities.js'
import {AsyncFunction} from '../../types/AsyncFunction.js'
import {IConstructor} from '../../interfaces/IConstructor.js'
import {BaseObject} from './BaseObject.js'

export class Module<T extends Module = any> extends Component {

    @Configurable()
    protected readonly _$options: ModuleOptions<T>

    @Configurable()
    protected readonly _$parentContainer: Container

    protected readonly _$container: Container

    /**
     * Constructor
     * @param props
     */
    constructor(props: InjectionProperties = {}) {
        super(props)
    }

    /**
     * 模块初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.setProperty('_$container', new Container(this, this._$parentContainer))
        this.setProperty('_$options', await ModuleOptions.validateAsync(this._$options))
        await this._$container.registerModule(this)
        await this.bootstrap()
    }

    /**
     * 启动引导
     * @protected
     */
    protected async bootstrap(): Promise<void> {
        await this._$container.load(this._$options.entries)
        for (const item of this._$options.bootstrap) {
            if (typeof item === 'string') await this._$container.get(item)
            if (typeof item === 'function') isAsyncFunction(item) ? await As<AsyncFunction<ThisType<this>, void>>(item)(this) : await this._$container.get(As<IConstructor<BaseObject>>(item))
        }
    }
}
