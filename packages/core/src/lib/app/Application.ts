import {Module, MODULE_INITIALIZE_ERROR, MODULE_INITIALIZED} from '../core/Module.js'
import {Container} from '../core/Container.js'
import {ApplicationConfigLoader} from './ApplicationConfigLoader.js'
import {ApplicationOptions} from '../../options/ApplicationOptions.js'
import {Alias} from '../core/Alias.js'
import {GetAppId, GetAppName, GetBasicInfo} from '../foundation/BasicInfo.js'
import {SetLifecycleErrorReporter} from '../foundation/LifecycleErrorReporter.js'
import {ILogger} from '../../interfaces/ILogger.js'
import {ConsoleLogger} from '../../components/ConsoleLogger.js'
import {Accept} from '../../decorators/dto/Accept.js'
import {DTO} from '../dto/DTO.js'
import {mkdirSync} from 'fs'
import path from 'node:path'
import {existsSync} from 'node:fs'
import {constants} from 'node:os'
import {As} from '@lakutata/utils/As'
import {SynchronousEventEmitter} from '../base/EventEmitter.js'
import {type MigrationCommand, ReadMigrationCommand} from './MigrationCommand.js'
import {type ApplicationExitReason} from '../../types/ApplicationExitReason.js'
import {BootstrapOption, ModuleOptions} from '../../options/ModuleOptions.js'
import {DeclareApplicationClass, MarkApplicationLaunched} from '../base/internal/ApplicationLaunch.js'

//The handlers are method signatures, so a handler may declare the logger implementation it expects (such as Logger)
/**
 * On application launched event handler
 */
export type LaunchedHandler = { handler(app: Application, logger: ILogger): void | Promise<void> }['handler']
/**
 * On application done event handler
 */
export type DoneHandler = { handler(app: Application, logger: ILogger, reason: ApplicationExitReason): void | Promise<void> }['handler']
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
    protected static readonly eventEmitter: SynchronousEventEmitter = new SynchronousEventEmitter()

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
     * The application exits: its handler runs before the entrypoints stop and the objects are destroyed, the application
     * still working; it is given why the application exits (its exit code, the signal ending it)
     * @param handler
     */
    public static onDone(handler: DoneHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.Done, async (app: Application, reason: ApplicationExitReason) => handler(app, await app.getLogger(), reason))
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
        this.launchTimeout = setTimeout((): void => {
            process.on('uncaughtException', (error: Error): void => void this.processUncaughtException(error))
            this.launchApplication()
                .then((app: Application): unknown => Reflect.set(this, 'appInstance', app))
                .catch((e: any): void => this.processFatalException(e))
        })
        return this
    }

    /**
     * Process uncaught exception: the handlers of onUncaughtException(), or the logger (the console when the logger
     * cannot be got)
     * @param error
     * @protected
     */
    protected static async processUncaughtException(error: Error): Promise<void> {
        if (this.eventEmitter.listenerCount(ApplicationState.UncaughtException)) {
            this.eventEmitter.emit(ApplicationState.UncaughtException, error)
            return
        }
        const exception: Error = new Error('UncaughtException', {cause: error})
        try {
            const logger: ILogger = await this.getLogger()
            logger.warn(exception)
        } catch (e) {
            console.error(exception, e)
        }
    }

    /**
     * Process fatal exception: the handler of onFatalException(), or the logger (the console when the logger cannot be
     * got), then the application exits with the code 1 (as Node.js on an uncaught exception): it cannot run, and the
     * objects already created (a server listening, a connection) would keep the process alive
     * @param error
     * @protected
     */
    protected static processFatalException(error: Error): void {
        if (!this.eventEmitter.listenerCount(ApplicationState.FatalException)) {
            return process.nextTick(async (): Promise<never> => {
                const exception: Error = new Error('FatalException', {cause: error})
                try {
                    const logger: ILogger = await this.getLogger()
                    logger.error(exception)
                } catch (e) {
                    console.error(exception, e)
                }
                return process.exit(1)
            })
        }
        this.eventEmitter.emit(ApplicationState.FatalException, error)
    }

    /**
     * End the application gracefully on the signals: its exit (the requests running complete, the objects destroyed, the
     * done handler, the code 0); a second signal, or a signal received while it launches, ends the process at once with
     * the code 128 + the number of the signal
     * @param signals
     * @protected
     */
    protected static listenShutdownSignals(signals: NodeJS.Signals[]): void {
        let ending: boolean = false
        for (const signal of signals) {
            process.on(signal, (): void => {
                const code: number = 128 + (constants.signals[signal] ?? 0)
                if (ending || !this.appInstance) return process.exit(code)
                ending = true
                //The exit of the application, ended by the signal
                this.eventEmitter.emit('exit', this.appInstance, 0, signal)
            })
        }
    }

    /**
     * Internal launch application process
     * @protected
     */
    protected static async launchApplication(): Promise<Application> {
        this.eventEmitter.once('exit', async (app: Application, exitCode: number, signal?: NodeJS.Signals) => {
            try {
                //The done handler, told why the application exits
                const reason: ApplicationExitReason = signal ? {code: exitCode ? exitCode : 0, signal: signal} : {code: exitCode ? exitCode : 0}
                await this.eventEmitter.emitRequest(ApplicationState.Done, app, reason)
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
        //The commands of the migrations of the databases: the application connects its databases, does the command and exits
        let migrationCommand: MigrationCommand | undefined
        try {
            migrationCommand = ReadMigrationCommand(process.env)
        } catch (error) {
            //A command of the migrations fails with the code 1, the tools running it know it
            console.error((error as Error).message)
            process.exit(1)
        }
        if (migrationCommand) {
            this.eventEmitter.removeAllListeners(ApplicationState.Launched)
            this.eventEmitter.removeAllListeners(ApplicationState.Done)
            this.eventEmitter.removeAllListeners(ApplicationState.UncaughtException)
            this.eventEmitter.removeAllListeners(ApplicationState.FatalException)
            //The classes of the databases (the Database classes of the orm package) are recognized by the static lazy
            //loaders of their providers (migrationGenerator, migrationExecutor), so core never references the orm package.
            const loaderName: 'migrationGenerator' | 'migrationExecutor' = migrationCommand.action === 'generate' ? 'migrationGenerator' : 'migrationExecutor'
            interface MigrationTarget {
                dataSourceName: string
                dataSourceOptions: Record<string, any>
                loader: () => Promise<any>
            }
            const getMigrationTargets: (input: Record<string, any>) => MigrationTarget[] = (input: Record<string, any>) => {
                const migrationTargets: MigrationTarget[] = []
                for (const name in input) {
                    const objectClass: any = input[name]?.class
                    if (typeof objectClass?.[loaderName] === 'function') {
                        const dataSourceOptions: Record<string, any> = input[name].options
                        if (!dataSourceOptions) continue
                        Reflect.set(dataSourceOptions, 'dataSourceName', name)
                        migrationTargets.push({dataSourceName: name, dataSourceOptions: dataSourceOptions, loader: objectClass[loaderName]})
                    }
                }
                return migrationTargets
            }
            let migrationTargets: MigrationTarget[] = [
                ...(options.components ? getMigrationTargets(options.components) : []),
                ...(options.providers ? getMigrationTargets(options.providers) : [])
            ]
            const names: string = migrationTargets.map((target: MigrationTarget): string => target.dataSourceName).join(', ')
            if (migrationCommand.database) {
                migrationTargets = migrationTargets.filter((target: MigrationTarget): boolean => target.dataSourceName === migrationCommand.database)
                if (!migrationTargets.length) {
                    console.error(`The application has no database ${migrationCommand.database} (${names || 'no Database component or provider'})`)
                    process.exit(1)
                }
            }
            if (!migrationTargets.length) {
                //Nothing to generate; the other commands need a database
                if (migrationCommand.action === 'generate') process.exit(0)
                console.error('The application has no Database component or provider')
                process.exit(1)
            }
            if (migrationCommand.action === 'revert' && migrationTargets.length > 1) {
                console.error(`The application has several databases (${names}): MIGRATION_DATABASE selects the one whose last migration is reverted`)
                process.exit(1)
            }
            options.bootstrap = []
            if (!options.providers) options.providers = {}
            for (let index: number = 0; index < migrationTargets.length; index++) {
                const migrationTarget: MigrationTarget = migrationTargets[index]
                const migrationProviderName: string = `Migration${index}${Date.now()}`
                const common: Record<string, any> = {
                    class: await migrationTarget.loader(),
                    exitProcess: index === migrationTargets.length - 1,
                    dataSourceName: migrationTarget.dataSourceName,
                    dataSource: migrationTarget.dataSourceOptions
                }
                options.providers[migrationProviderName] = migrationCommand.action === 'generate'
                    ? {...common, path: migrationCommand.path, outputJs: false}
                    : {...common, action: migrationCommand.action, transaction: migrationCommand.transaction, fake: migrationCommand.fake}
                options.bootstrap.push(migrationProviderName)
            }
        }
        const rootContainer: Container = new Container()
        return new Promise((resolve, reject): void => {
            ApplicationOptions
                .validateAsync(options)
                .then((applicationOptions: ApplicationOptions) => {
                    if (applicationOptions.shutdownSignals) this.listenShutdownSignals(applicationOptions.shutdownSignals)
                    applicationOptions.bootstrap?.push(async (target: Module) => {
                        const launchedCallbackRemover = function (this: Application) {
                            this.options.bootstrap?.pop()
                            As<BootstrapOption[]>(Reflect.getOwnMetadata('#bootstrap', this))?.pop()
                        }
                        launchedCallbackRemover.bind(As<Application>(target))()
                        //The errors of the lifecycle of the objects (cascaded destruction, launched hooks) are reported through the application logger
                        const logger: ILogger = await As<Application>(target).getLogger()
                        SetLifecycleErrorReporter((error: Error, message: string): void => logger.warn(error, message))
                        MarkApplicationLaunched(target)
                        //The application launched is the one the signals end (its launched handlers may receive them)
                        Reflect.set(this, 'appInstance', target)
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
