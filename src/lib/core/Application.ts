import {Module, MODULE_INITIALIZE_ERROR, MODULE_INITIALIZED} from './Module.js'
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
import {As} from '../helpers/As.js'
import {EventEmitter} from '../base/EventEmitter.js'
import {BootstrapOption} from '../../options/ModuleOptions.js'

/**
 * On application launched event handler
 */
export type LaunchedHandler = (app: Application, logger: Logger) => void | Promise<void>
/**
 * On application done event handler
 */
export type DoneHandler = (app: Application, logger: Logger) => void | Promise<void>
/**
 * On process uncaught exception event handler
 */
export type UncaughtExceptionHandler = (error: Error, logger: Logger) => void | Promise<void>
/**
 * On application fatal exception event handler
 */
export type FatalExceptionHandler = (error: Error, logger: Logger) => number | undefined | void | Promise<number | undefined | void>

/**
 * Application states
 */
export enum ApplicationState {
    Launched = 'LAUNCHED',
    Done = 'DONE',
    UncaughtException = 'UNCAUGHT_EXCEPTION',
    FatalException = 'FATAL_EXCEPTION'
}

/**
 * Application module
 */
@Singleton(true)
export class Application extends Module {

    /**
     * Event emitter
     * @protected
     */
    protected static readonly eventEmitter: EventEmitter = new EventEmitter()

    /**
     * Application instance, if the application boot failed, the property will be undefined
     * @protected
     */
    protected static readonly appInstance: Application | undefined

    /**
     * Environment variables map
     * @protected
     */
    protected static readonly environmentVariableMap: Map<string, string> = new Map()

    /**
     * Alias declarations
     * @protected
     */
    protected static readonly aliasDeclarations: {
        alias: Record<string, string>
        createIfNotExist: boolean
    }[] = []

    /**
     * Options or options getter function for application booting
     * @protected
     */
    protected static readonly launchOptions: ApplicationOptions | (() => ApplicationOptions | Promise<ApplicationOptions>)

    /**
     * The timer for application booting.
     * This property will be overwriting multiple times during static invoke-chain
     * @protected
     */
    protected static launchTimeout: NodeJS.Timeout

    /**
     * Get logger
     * @protected
     */
    protected static async getLogger(): Promise<Logger> {
        return this.appInstance ? await this.appInstance.getObject('log') : await new Container().set(Logger)
    }

    /**
     * Set environment variables
     * @param env
     */
    @Accept(DTO.Object().pattern(DTO.String(), DTO.String()).required())
    public static env(env: Record<string, string>): typeof Application {
        Object.keys(env).forEach((key: string) => this.environmentVariableMap.set(key, env[key]))
        return this.launch()
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
        return this.launch()
    }

    /**
     * Application has been launched
     * @param handler
     */
    public static onLaunched(handler: LaunchedHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.Launched, async (app: Application) => handler(app, await app.getObject('log')))
        return this.launch()
    }

    /**
     * Application execution completed successfully
     * @param handler
     */
    public static onDone(handler: DoneHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.Done, async (app: Application) => handler(app, await app.getObject('log')))
        return this.launch()
    }

    /**
     * Uncaught exception occurred during application execution
     * @param handler
     */
    public static onUncaughtException(handler: UncaughtExceptionHandler): typeof Application {
        this.eventEmitter.on(ApplicationState.UncaughtException, async (error: Error) => {
            const logger: Logger = await this.getLogger()
            await handler(error, logger)
        })
        return this.launch()
    }

    /**
     * Fatal exception occurred during application execution
     * @param handler
     */
    public static onFatalException(handler: FatalExceptionHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.FatalException, async (error: Error) => {
            const logger: Logger = await this.getLogger()
            let exitCode: number | undefined | void = await handler(error, logger)
            if (typeof exitCode !== 'number') exitCode = 1
            return process.exit(exitCode)
        })
        return this.launch()
    }

    /**
     * Run application with options object
     * @param options
     */
    public static run(options: ApplicationOptions): typeof Application
    /**
     * Run application with options getter
     * @param optionsGetter
     */
    public static run(optionsGetter: () => ApplicationOptions | Promise<ApplicationOptions>): typeof Application
    public static run(inp: ApplicationOptions | (() => ApplicationOptions | Promise<ApplicationOptions>)): typeof Application {
        Reflect.set(this, 'launchOptions', inp)
        return this.launch()
    }

    /**
     * Launch application after invoke chain processed
     * @protected
     */
    protected static launch(): typeof Application {
        if (this.launchTimeout) clearTimeout(this.launchTimeout)
        this.launchTimeout = setTimeout(async () => {
            process
                .on('uncaughtException', async (error: Error) => {
                    if (this.eventEmitter.listenerCount(ApplicationState.UncaughtException))
                        return this.eventEmitter.emit(ApplicationState.UncaughtException, error)
                    const logger: Logger = await this.getLogger()
                    return logger.warn(new Error('UncaughtException', {cause: error}))
                })
            try {
                Reflect.set(this, 'appInstance', await this.launchApplication())
            } catch (e: any) {
                this.processFatalException(e)
            }
        })
        return this
    }

    /**
     * Process fatal exception
     * @param error
     * @protected
     */
    protected static processFatalException(error: Error): void {
        if (!this.eventEmitter.listenerCount(ApplicationState.FatalException)) {
            return process.nextTick(async () => {
                const logger: Logger = await this.getLogger()
                logger.error(new Error('FatalException', {cause: error}))
            })

        }
        this.eventEmitter.emit(ApplicationState.FatalException, error)
    }

    /**
     * Internal launch application process
     * @protected
     */
    protected static async launchApplication(): Promise<Application> {
        this.eventEmitter.once('exit', async (app: Application) => {
            try {
                //Emit onDone event request
                await this.eventEmitter.emitRequest(ApplicationState.Done, app)
                await rootContainer.destroy()
                process.exit(0)
            } catch (e) {
                process.exit(1)
            }
        })
        this.environmentVariableMap.forEach((value, key) => process.env[key] = value)
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
        const options: ApplicationOptions = typeof this.launchOptions === 'object' ? this.launchOptions : await this.launchOptions()
        const rootContainer: Container = new Container()
        return new Promise((resolve, reject): void => {
            ApplicationOptions
                .validateAsync(options)
                .then((applicationOptions: ApplicationOptions) => {
                    applicationOptions.bootstrap?.push(async (target: Module) => {
                        const launchedCallbackRemover = function (this: Application) {
                            this.options.bootstrap?.pop()
                            As<BootstrapOption[]>(Reflect.getOwnMetadata('#bootstrap', this))?.pop()
                        }
                        launchedCallbackRemover.bind(As<Application>(target))()
                        this.eventEmitter.emit(ApplicationState.Launched, As<Application>(target))
                    })
                    rootContainer
                        .set(Application, {options: applicationOptions})
                        .then((app: Application) => app
                            .once(MODULE_INITIALIZED, () => resolve(app))
                            .once(MODULE_INITIALIZE_ERROR, (error: Error) => this.processFatalException(error))
                        )
                        .catch(reject)
                })
                .catch(reject)
        })
    }

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
        bootstrap: ['log']
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
        if (force) return process.exit(2)
        Application.eventEmitter.emit('exit', this)
    }
}
