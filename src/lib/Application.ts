import {ApplicationOptions} from '../options/ApplicationOptions'
import {Container} from './base/Container'
import {Module} from './base/Module'
import {IConstructor} from '../interfaces/IConstructor'
import {LoadComponentOptions} from '../options/LoadComponentOptions'
import {Formatter} from './components/Formatter'
import {Singleton} from '../decorators/DependencyInjectionDecorators'
import {Logger} from './components/Logger'
import {AsyncFunction} from '../types/AsyncFunction'
import {As} from '../Helper'
import {DefaultLoggerProvider} from './DefaultLoggerProvider'
import {Alias} from './Alias'
import {AccessControl} from './components/access-control/AccessControl'
import {Time} from '../exports/Time'

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
            },
            access: {
                class: AccessControl
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
    public static async run(options: ApplicationOptions, ...partialOptions: Partial<ApplicationOptions>[]): Promise<Application> {
        const appOpts: ApplicationOptions = await ApplicationOptions.validateAsync(Object.assign(options, ...partialOptions))
        process.env.appId = appOpts.id
        process.env.appName = appOpts.name
        process.env.TZ = appOpts.timezone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : appOpts.timezone
        process.env.NODE_ENV = appOpts.mode ? appOpts.mode : 'development'
        process.title = process.env.appId
        const alias: Alias = Alias.getAliasInstance()
        alias.set('@app', process.env.ENTRYPOINT_DIR)//预设别名：应用程序入口文件所在目录路径
        alias.set('@runtime', process.cwd())//预设别名：应用程序的工作目录路径
        const aliases: Record<string, string> = appOpts.alias ? appOpts.alias : {}
        Object.keys(aliases).forEach((aliasName: string) => alias.set(aliasName, aliases[aliasName]))
        const rootContainer: Container = new Container()
        const name: string = Container.stringifyConstructor(Application)
        return await rootContainer.createObject(name, {
            class: Application,
            __$$options: appOpts,
            __$$parentContainer: rootContainer
        })
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
     * 程序上线时长(秒)
     */
    public get uptime(): number {
        return new Time().unix() - this.getInternalProperty<number>('startupTimestamp')
    }

    /**
     * 内部初始化函数
     * @protected
     */
    protected async __init(): Promise<void> {
        this.setInternalProperty('startupTimestamp', new Time().unix())
        await super.__init()
    }

    /**
     * 退出应用程序
     * @param force
     */
    public exit(force: boolean = false): void {
        if (!force) {
            this.__$$parentContainer.destroy().then(() => process.exit(0))
        } else {
            process.exit(0)
        }
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


