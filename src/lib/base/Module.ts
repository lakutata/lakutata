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
    protected readonly __$$options: ModuleOptions<T>

    @Configurable()
    protected readonly __$$parentContainer: Container

    protected readonly __$$container: Container

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
        this.setProperty('__$$container', new Container(this, this.__$$parentContainer))
        this.setProperty('__$$options', await ModuleOptions.validateAsync(this.__$$options))
        await this.__$$container.registerModule(this)
        await this.__bootstrap()
    }

    // protected load

    /**
     * 启动引导
     * @protected
     */
    protected async __bootstrap(): Promise<void> {
        await this.__$$container.load(this.__$$options.entries)
        for (const item of this.__$$options.bootstrap) {
            if (typeof item === 'string') await this.__$$container.get(item)
            if (typeof item === 'function') isAsyncFunction(item) ? await As<AsyncFunction<ThisType<this>, void>>(item)(this) : await this.__$$container.get(As<IConstructor<BaseObject>>(item))
        }
    }

    /**
     * 模块内部销毁函数
     * @protected
     */
    protected async __destroy(): Promise<void> {
        await this.__$$container?.destroy()//在应用程序加载模块的时候需要初始化模块的IoC容器
        return super.__destroy()
    }

    /**
     * 模块销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        //在子类中覆写
    }
}
