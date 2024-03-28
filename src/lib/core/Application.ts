import {Module, MODULE_INITIALIZED} from './Module.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {Container} from './Container.js'
import {ApplicationConfigLoader} from '../base/internal/ApplicationConfigLoader.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {Alias} from './Alias.js'
import {GetBasicInfo} from '../base/internal/BasicInfo.js'
import {Entrypoint} from '../../components/Entrypoint.js'
import {Logger} from '../../components/Logger.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {DTO} from './DTO.js'
import {mkdirSync} from 'fs'
import path from 'node:path'
import {existsSync} from 'node:fs'

const RCTNR: symbol = Symbol('ROOT_CONTAINER')

@Singleton(true)
export class Application extends Module {

    /**
     * Alias declarations
     * @protected
     */
    protected static readonly aliasDeclarations: {
        alias: Record<string, string>
        createIfNotExist: boolean
    }[] = []

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
        }
    }

    /**
     * Set environment variables
     * @param env
     */
    @Accept(DTO.Object().pattern(DTO.String(), DTO.String()).required())
    public static env(env: Record<string, string>): typeof Application {
        Object.keys(env).forEach((key: string) => process.env[key] = env[key])
        return this
    }

    /**
     * Register path aliases
     * @param alias
     * @param createIfNotExist
     */
    @Accept(
        DTO.Object().pattern(DTO.String(), DTO.String()).required(),
        DTO.Boolean().optional().default(false))
    public static alias(alias: Record<string, string>, createIfNotExist: boolean = false): typeof Application {
        this.aliasDeclarations.push({
            alias: alias ? alias : {},
            createIfNotExist: createIfNotExist
        })
        return this
    }

    /**
     * Run application with options object
     * @param options
     */
    public static async run(options: ApplicationOptions): Promise<Application>
    /**
     * Run application with options getter
     * @param optionsGetter
     */
    public static async run(optionsGetter: () => ApplicationOptions | Promise<ApplicationOptions>): Promise<Application>
    public static async run(inp: ApplicationOptions | (() => ApplicationOptions | Promise<ApplicationOptions>)): Promise<Application> {
        //Alias registration must be done before application container create
        const aliasManager: Alias = Alias.getAliasInstance()
        aliasManager.set('@runtime', process.cwd())
        this.aliasDeclarations.forEach(aliasDeclaration => {
            const aliases: Record<string, string> = aliasDeclaration.alias
            const createIfNotExist: boolean = aliasDeclaration.createIfNotExist
            Object.keys(aliases).forEach((aliasName: string) => {
                aliasManager.set(aliasName, aliases[aliasName])
                if (createIfNotExist) {
                    const realPath: string = path.resolve(aliasName)
                    if (!existsSync(realPath)) mkdirSync(path.resolve(aliasName), {recursive: true})
                }
            })
        })
        const options: ApplicationOptions = typeof inp === 'object' ? inp : await inp()
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
