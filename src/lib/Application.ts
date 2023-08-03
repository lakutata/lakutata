import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Container} from './base/Container.js'
import {AsyncConstructor} from 'async-constructor'
import {isAsyncFunction} from 'util/types'
import {As} from '../Utilities.js'
import {AsyncFunction} from '../types/AsyncFunction.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {BaseObject} from './base/BaseObject.js'

export class Application extends AsyncConstructor {

    protected readonly options: ApplicationOptions

    protected readonly container: Container

    constructor(options: ApplicationOptions) {
        super(async (): Promise<void> => await this.bootstrap())
        this.options = ApplicationOptions.validate(options)
        process.env.appId = this.options.id
        process.env.appName = this.options.name
        process.env.TZ = this.options.timezone
        this.container = new Container()
    }

    /**
     * 应用程序启动引导
     * @protected
     */
    protected async bootstrap(): Promise<void> {
        await this.container.load(this.options.entries)
        for (const item of this.options.bootstrap) {
            if (typeof item === 'string') await this.container.get(item)
            if (typeof item === 'function') {
                if (isAsyncFunction(item)) {
                    //启动引导执行方法
                    await As<AsyncFunction<Application, void>>(item)(this)
                } else {
                    //类构造函数
                    await this.container.get(As<IConstructor<BaseObject>>(item))
                }
            }
        }
    }

    /**
     * 退出应用程序
     */
    public async exit(): Promise<void> {
        await this.container.destroy()
        process.exit(0)
    }

}
