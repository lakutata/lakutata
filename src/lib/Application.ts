import {ApplicationOptions} from '../options/ApplicationOptions'
import {Container} from './base/Container'
import {Module} from './base/Module'
import {IConstructor} from '../interfaces/IConstructor'
import {LoadComponentOptions} from '../options/LoadComponentOptions'
import {Formatter} from './components/Formatter'
import {Singleton} from '../decorators/DependencyInjectionDecorators'
import {Logger} from './components/Logger'
import {AsyncFunction} from '../types/AsyncFunction'
import {As} from '../exports/Utilities'
import {DefaultLoggerProvider} from './DefaultLoggerProvider'
import {Alias} from './Alias'

@Singleton(true)
export class Application extends Module {

    /**
     * 别名管理器对象
     * @protected
     */
    protected readonly alias: Alias = Alias.getAliasInstance()

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
        const alias: Alias = Alias.getAliasInstance()
        alias.set('@app', process.env.ENTRYPOINT_DIR)//预设别名：应用程序入口文件所在目录路径
        alias.set('@runtime', process.cwd())//预设别名：应用程序的工作目录路径
        const aliases: Record<string, string> = options.alias ? options.alias : {}
        Object.keys(aliases).forEach((aliasName: string) => alias.set(aliasName, aliases[aliasName]))
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

    /**
     * 检查别名是否存在
     * @param alias
     */
    public hasAlias(alias: string): boolean {
        return this.alias.has(alias)
    }

    /**
     * 设置别名
     * @param alias
     * @param path
     */
    public setAlias(alias: string, path: string): void
    /**
     * 设置别名
     * @param alias
     * @param path
     * @param override
     */
    public setAlias(alias: string, path: string, override: boolean): void
    public setAlias(alias: string, path: string, override: boolean = false): void {
        return this.alias.set(alias, path, override)
    }

    /**
     * 获取别名所代表的路径
     * @param alias
     */
    public getAlias(alias: string): string {
        return this.alias.get(alias)
    }
}


