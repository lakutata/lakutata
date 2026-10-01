import {Module, MODULE_INITIALIZE_ERROR, MODULE_INITIALIZED} from '../core/Module.js'
import {Container} from '../core/Container.js'
import {ApplicationConfigLoader} from './ApplicationConfigLoader.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {Alias} from '../core/Alias.js'
import {GetAppId, GetAppName, GetBasicInfo} from '../foundation/BasicInfo.js'
import {SetDestroyErrorReporter} from '../foundation/DestroyErrorReporter.js'
import {ILogger} from '../../interfaces/ILogger.js'
import {ConsoleLogger} from '../../components/ConsoleLogger.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {DTO} from '../dto/DTO.js'
import {mkdirSync} from 'fs'
import path from 'node:path'
import {existsSync} from 'node:fs'
import {As} from '@lakutata/utils/helper/As'
import {EventEmitter} from '../base/EventEmitter.js'
import {BootstrapOption, ModuleOptions} from '../../options/ModuleOptions.js'
import {DeclareApplicationClass, MarkApplicationLaunched} from './ApplicationLaunch.js'

//The handlers are method signatures, so a handler may declare the logger implementation it expects (such as Logger)
/**
 * On application launched event handler
 */
export type LaunchedHandler = { handler(app: Application, logger: ILogger): void | Promise<void> }['handler']
/**
 * On application done event handler
 */
export type DoneHandler = { handler(app: Application, logger: ILogger): void | Promise<void> }['handler']
/**
 * On process uncaught exception event handler
 */
export type UncaughtExceptionHandler = { handler(error: Error, logger: ILogger): void | Promise<void> }['handler']
/**
 * On application fatal exception event handler
 */
export type FatalExceptionHandler = { handler(error: Error, logger: ILogger): number | undefined | void | Promise<number | undefined | void> }['handler']

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
     * The options preset for the applications, see preset()
     * @protected
     */
    protected static readonly presetOptions: ModuleOptions = {}

    /**
     * The logger of the applications without "log" component
     * @private
     */
    static #consoleLogger: Promise<ILogger> | undefined

    /**
     * Preset the options of the applications, before they run: the preset objects are loaded first and the objects of
     * the same name given to run() replace them, the preset bootstrap runs first. The packages assembling the framework
     * preset their components (such as the Logger and the Entrypoint of lakutata). Each call adds to the preset: its
     * components, providers and named objects replace the preset ones of the same name
     * @param options
     */
    public static preset(options: ModuleOptions): typeof Application {
        const preset: ModuleOptions = this.presetOptions
        if (options.components) Reflect.set(preset, 'components', {...preset.components, ...options.components})
        if (options.providers) Reflect.set(preset, 'providers', {...preset.providers, ...options.providers})
        if (options.objects) Reflect.set(preset, 'objects', {
            named: {...preset.objects?.named, ...options.objects.named},
            anonymous: [...(preset.objects?.anonymous ?? []), ...(options.objects.anonymous ?? [])]
        })
        if (options.bootstrap) Reflect.set(preset, 'bootstrap', [...new Set([...(preset.bootstrap ?? []), ...options.bootstrap])])
        return this
    }

    /**
     * Get logger: the "log" component of the application, or the console when there is no application or no "log"
     * component
     * @protected
     */
    protected static async getLogger(): Promise<ILogger> {
        return this.appInstance ? await this.appInstance.getLogger() : await this.getConsoleLogger()
    }

    /**
     * The console logger, created once
     * @protected
     */
    protected static getConsoleLogger(): Promise<ILogger> {
        if (!this.#consoleLogger) this.#consoleLogger = new Container().set(ConsoleLogger)
        return this.#consoleLogger
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
        this.eventEmitter.once(ApplicationState.Launched, async (app: Application) => handler(app, await app.getLogger()))
        return this.launch()
    }

    /**
     * Application execution completed successfully
     * @param handler
     */
    public static onDone(handler: DoneHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.Done, async (app: Application) => handler(app, await app.getLogger()))
        return this.launch()
    }

    /**
     * Uncaught exception occurred during application execution
     * @param handler
     */
    public static onUncaughtException(handler: UncaughtExceptionHandler): typeof Application {
        this.eventEmitter.on(ApplicationState.UncaughtException, async (error: Error) => {
            const logger: ILogger = await this.getLogger()
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
            const logger: ILogger = await this.getLogger()
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
                    const logger: ILogger = await this.getLogger()
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
                const logger: ILogger = await this.getLogger()
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
        this.eventEmitter.once('exit', async (app: Application, exitCode: number) => {
            try {
                //Emit onDone event request
                await this.eventEmitter.emitRequest(ApplicationState.Done, app)
                await rootContainer.destroy()
                process.exit(exitCode ? exitCode : 0)
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
        //Generate database migrations
        for (const env in process.env) {
            switch (env.toUpperCase()) {
                case 'MIGRATION_GENERATE': {
                    this.eventEmitter.removeAllListeners(ApplicationState.Launched)
                    this.eventEmitter.removeAllListeners(ApplicationState.Done)
                    this.eventEmitter.removeAllListeners(ApplicationState.UncaughtException)
                    this.eventEmitter.removeAllListeners(ApplicationState.FatalException)
                    const migrationTargetDir: string = process.env[env]!
                    //The classes generating migrations (the Database classes of the orm package) are recognized by their
                    //static migrationGenerator, a lazy loader of their generator, so core never references the orm package.
                    interface MigrationTarget {
                        dataSourceName: string
                        dataSourceOptions: Record<string, any>
                        migrationGenerator: () => Promise<any>
                    }
                    const getMigrationTargets: (input: Record<string, any>) => MigrationTarget[] = (input: Record<string, any>) => {
                        const migrationTargets: MigrationTarget[] = []
                        for (const name in input) {
                            const objectClass: any = input[name]?.class
                            if (typeof objectClass?.migrationGenerator === 'function') {
                                const dataSourceOptions: Record<string, any> = input[name].options
                                if (!dataSourceOptions) continue
                                Reflect.set(dataSourceOptions, 'dataSourceName', name)
                                migrationTargets.push({
                                    dataSourceName: name,
                                    dataSourceOptions: dataSourceOptions,
                                    migrationGenerator: objectClass.migrationGenerator
                                })
                            }
                        }
                        return migrationTargets
                    }
                    const migrationTargets: MigrationTarget[] = [
                        ...(options.components ? getMigrationTargets(options.components) : []),
                        ...(options.providers ? getMigrationTargets(options.providers) : [])
                    ]
                    if (!migrationTargets.length) process.exit(0)
                    options.bootstrap = []
                    for (let index: number = 0; index < migrationTargets.length; index++) {
                        const migrationTarget: MigrationTarget = migrationTargets[index]
                        const migrationProviderName: string = `GenerateMigration${index}${Date.now()}`
                        if (!options.providers) options.providers = {}
                        options.providers[migrationProviderName] = {
                            class: await migrationTarget.migrationGenerator(),
                            path: migrationTargetDir,
                            outputJs: false,
                            exitProcess: index === migrationTargets.length - 1,
                            dataSourceName: migrationTarget.dataSourceName,
                            dataSource: migrationTarget.dataSourceOptions
                        }
                        options.bootstrap!.push(migrationProviderName)
                    }
                }
                    break
            }
        }
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
                        //Errors raised by cascaded destruction are reported through the application logger
                        const logger: ILogger = await As<Application>(target).getLogger()
                        SetDestroyErrorReporter((error: Error): void => logger.warn(error, 'An error occurred while destroying an object'))
                        MarkApplicationLaunched(target)
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
    protected options: Partial<ApplicationOptions> = Application.copyPresetOptions()

    /**
     * A copy of the preset options, for an application
     * @protected
     */
    protected static copyPresetOptions(): ModuleOptions {
        const preset: ModuleOptions = Application.presetOptions
        return {
            ...(preset.components ? {components: {...preset.components}} : {}),
            ...(preset.providers ? {providers: {...preset.providers}} : {}),
            ...(preset.objects ? {objects: {named: {...preset.objects.named}, anonymous: [...(preset.objects.anonymous ?? [])]}} : {}),
            bootstrap: [...(preset.bootstrap ?? [])]
        }
    }

    /**
     * The logger of the application: its "log" component, or the console when it has none
     * @protected
     */
    protected async getLogger(): Promise<ILogger> {
        return this.container.has('log') ? As<ILogger>(await this.getObject('log')) : await Application.getConsoleLogger()
    }

    /**
     * Alias manager
     */
    public get alias(): Alias {
        return Alias.getAliasInstance()
    }

    /**
     * The ID of the application, available before the application is created ("Unknown" until its options are loaded)
     */
    public static get appId(): string {
        return GetAppId()
    }

    /**
     * The name of the application, available before the application is created ("Unknown" until its options are loaded)
     */
    public static get appName(): string {
        return GetAppName()
    }

    /**
     * Get application's ID
     */
    public get appId(): string {
        return GetAppId()
    }

    /**
     * Get application's name
     */
    public get appName(): string {
        return GetAppName()
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
     * @param exitCode
     */
    public exit(exitCode: number): void
    /**
     * Exit application
     * @param force
     */
    public exit(force: true): void
    public exit(forceOrExitCode?: boolean | number): void {
        if (typeof forceOrExitCode === 'boolean' && forceOrExitCode) {
            return process.exit(2)
        } else {
            Application.eventEmitter.emit('exit', this, forceOrExitCode ? forceOrExitCode : 0)
        }
    }
}

DeclareApplicationClass(Application)
