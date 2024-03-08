import {Module} from './Module.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {Container} from './Container.js'
import {__destroy, __init} from '../base/BaseObject.js'
import {ApplicationConfigLoader} from '../base/internal/ApplicationConfigLoader.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {ModuleOptions} from '../../options/ModuleOptions.js'
import {Alias} from '../Alias.js'

@Singleton(true)
export class Application extends Module {

    /**
     * Override config loader
     * @protected
     */
    protected ConfigLoader = ApplicationConfigLoader

    /**
     * Application embed options
     * @protected
     */
    protected options: ModuleOptions = {
        //TODO 自带组件的声明
    }

    /**
     * Run application
     * @param options
     */
    public static async run(options: ApplicationOptions): Promise<Application> {
        Alias.init()
        const rootContainer: Container = new Container()
        Reflect.defineMetadata(Application, rootContainer, Application)
        return await rootContainer.set(Application, {
            options: await ApplicationOptions.validateAsync(options)
        })
    }

    /**
     * Internal initializer
     * @protected
     */
    protected async [__init](): Promise<void> {
        return super[__init](async (): Promise<void> => {
            //TODO
            // console.log(this)
            // console.log(path.resolve('@test', './hahahaha'))
        })
    }

    /**
     * Internal destroyer
     * @protected
     */
    protected async [__destroy](): Promise<void> {
        await super[__destroy]()
        //TODO
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        //TODO
        console.log(await this.getObject('testModule'))
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        return super.destroy()
    }

    /**
     * Alias manager
     */
    public get alias(): Alias {
        return Alias.getAliasInstance()
    }

    /**
     * Get application's ID
     */
    public get appId(): string {
        return ''//TODO
    }

    /**
     * Get application's name
     */
    public get appName(): string {
        return ''//TODO
    }

    /**
     * Get application's timezone
     */
    public get timezone(): string {
        return ''//TODO
    }

    /**
     * Get application's uptime
     */
    public get uptime(): number {
        return 0//TODO
    }

    /**
     * Exit application
     * @param force
     */
    public exit(force?: boolean): void {
        const exit: () => void = () => process.exit(0)
        if (force) return exit()
        const rootContainer: Container = Reflect.getOwnMetadata(Application, Application)
        rootContainer.destroy().then(exit).catch(exit)
    }
}
