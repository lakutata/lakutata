import {ApplicationOptions} from '../options/ApplicationOptions.js'
import {Container} from './base/Container.js'
import {Module} from './base/Module.js'
import {IConstructor} from '../interfaces/IConstructor.js'
import {LoadComponentOptions} from '../options/LoadComponentOptions.js'
import {Formatter} from '../components/Formatter.js'
import {Singleton} from '../decorators/DependencyInjectionDecorators.js'

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
            }
        }
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
     * 退出应用程序
     */
    public exit(): void {
        this.__$$parentContainer.destroy().then(() => process.exit(0))
    }
}


