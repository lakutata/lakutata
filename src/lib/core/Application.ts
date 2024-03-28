import {Module, MODULE_INITIALIZED} from './Module.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {Container} from './Container.js'
import {ApplicationConfigLoader} from '../base/internal/ApplicationConfigLoader.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {Alias} from './Alias.js'
import {GetBasicInfo} from '../base/internal/BasicInfo.js'
import {Entrypoint} from '../../components/Entrypoint.js'
import {Logger} from '../../components/Logger.js'

const RCTNR: symbol = Symbol('ROOT_CONTAINER')

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
    protected options: Partial<ApplicationOptions> = {
        components: {
            log: {
                class: Logger
            },
            entrypoint: {
                class: Entrypoint
            }
        },
        alias: {
            '@runtime': process.cwd()
        }
    }

    /**
     * Run application
     * @param options
     */
    public static async run(options: ApplicationOptions): Promise<Application> {
        Alias.init()
        //Alias registration must be done before application container create
        ApplicationConfigLoader.registerAlias(options)
        const rootContainer: Container = new Container()
        Reflect.defineMetadata(RCTNR, rootContainer, Application)
        return new Promise((resolve, reject): void => {
            ApplicationOptions
                .validateAsync(options)
                .then((applicationOptions: ApplicationOptions) => rootContainer
                    .set(Application, {options: applicationOptions})
                    .then((app: Application) => app.once(MODULE_INITIALIZED, () => resolve(app)))
                    .catch(reject)
                )
                .catch(reject)
        })
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        //TODO

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
        return GetBasicInfo().appId
    }

    /**
     * Get application's name
     */
    public get appName(): string {
        return GetBasicInfo().appName
    }

    /**
     * Get application's timezone
     */
    public get timezone(): string {
        return GetBasicInfo().timezone
    }

    /**
     * Get application's uptime
     */
    public get uptime(): number {
        return Math.floor(process.uptime())
    }

    /**
     * Exit application
     * @param force
     */
    public exit(force?: boolean): void {
        const exit: () => void = () => process.exit(0)
        const rootContainer: Container = Reflect.getOwnMetadata(RCTNR, Application)
        rootContainer.destroy().then(exit).catch(exit)
        if (force) return exit()
    }
}
