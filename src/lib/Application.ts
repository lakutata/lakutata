import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Container} from './base/Container.js'
import {Module} from './base/Module.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {LoadComponentOptions} from '../options/LoadComponentOptions.js'
import {Formatter} from './components/Formatter.js'
import {Singleton} from '../decorators/DependencyInjectionDecorators.js'
import {Logger} from './components/Logger.js'
import {AsyncFunction} from '../types/AsyncFunction.js'
import {As} from '../exports/Utilities.js'
import {DefaultLoggerProvider} from './DefaultLoggerProvider.js'

@Singleton(true)
export class Application extends Module {

    /**
     * 应用程序预设组件
     * @protected
     */
    protected async components(): Promise<Record<string, IConstructor<any> | LoadComponentOptions<any>>> {
        return {
            formatter: {
                class: Formatter
            },
            log: {
                class: Logger,
                provider: DefaultLoggerProvider(process.env.NODE_ENV === 'development' ? 'trace' : 'info')
            }
        }
    }

    /**
     * 应用程序预设启动引导
     * @protected
     */
    protected async bootstrap<U extends Module>(): Promise<(string | IConstructor<any> | AsyncFunction<U, void>)[]> {
        console.log('import.meta.url:',import.meta.url)
        return ['log']
    }

    /**
     * 执行应用程序
     * @param options
     */
    public static async run(options: ApplicationOptions): Promise<Application> {
        options = await ApplicationOptions.validateAsync(options)
        process.env.appId = options.id
        process.env.appName = options.name
        process.env.TZ = options.timezone
        process.env.NODE_ENV = options.mode ? options.mode : 'development'
        const rootContainer: Container = new Container()
        const name: string = Container.stringifyConstructor(Application)
        await rootContainer.load({
            [name]: {
                class: Application,
                __$$options: options,
                __$$parentContainer: rootContainer
            }
        })
        return await rootContainer.get<Application>(name)
    }

    /**
     * 应用程序ID
     */
    public get appId(): string {
        return As<string>(process.env.appId)
    }

    /**
     * 应用程序名称
     */
    public get appName(): string {
        return As<string>(process.env.appName)
    }

    /**
     * 应用程序时区
     */
    public get timezone(): string {
        return As<string>(process.env.TZ)
    }

    /**
     * 退出应用程序
     */
    public exit(): void {
        this.__$$parentContainer.destroy().then(() => process.exit(0))
    }
}


