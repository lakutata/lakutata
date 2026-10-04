import {Module} from '../core/Module.js'
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
import {EndProcess, IsEnding} from '../foundation/EndProcess.js'

//The handlers are method signatures, so a handler may declare the logger implementation it expects (such as Logger)
/**
 * The handler of `Application.onLaunched()`: called with the application and its logger once it has launched.
 */
export type LaunchedHandler = { handler(app: Application, logger: ILogger): void | Promise<void> }['handler']
/**
 * The handler of `Application.onDone()`: called with the application, its logger and the reason of its exit.
 */
export type DoneHandler = { handler(app: Application, logger: ILogger, reason: ApplicationExitReason): void | Promise<void> }['handler']
/**
 * The handler of `Application.onUncaughtException()`: called with an uncaught error and the logger.
 */
export type UncaughtExceptionHandler = { handler(error: Error, logger: ILogger): void | Promise<void> }['handler']
/**
 * The handler of `Application.onFatalException()`: called with the error which stopped the launch and the logger;
 * returns the exit code of the process (1 when it returns none).
 */
export type FatalExceptionHandler = { handler(error: Error, logger: ILogger): number | undefined | void | Promise<number | undefined | void> }['handler']

/**
 * The events of the application's lifecycle.
 */
export enum ApplicationState {
    Launched = 'LAUNCHED',
    Done = 'DONE',
    UncaughtException = 'UNCAUGHT_EXCEPTION',
    FatalException = 'FATAL_EXCEPTION'
}

/**
 * The application: the root module, created and launched by the static fluent API. `Application.run()` gives its
 * options (its identity and its components, providers, objects and bootstrap); the other static calls set its
 * environment variables, path aliases and lifecycle handlers. The application launches once, in the turn of the event
 * loop following the first calls; the calls made once its launch started only add their handlers (`env()`, `alias()`
 * and `run()` have no effect then):
 * 1. the environment variables are set, the aliases registered (`@runtime` being the working directory);
 * 2. the options are read (from the getter given to `run()`, which may be async) and validated, the identity applied
 *    (`process.title` is the application ID, the time zone and the mode set);
 * 3. the application is created in a new root container: its objects are registered and its bootstrap runs in order;
 * 4. the `onLaunched()` handlers and the objects' `launched()` hooks run.
 *
 * A failure of steps 1 to 3 is a fatal exception: the `onFatalException()` handler runs (or the error is logged), then
 * the process exits (code 1 by default). The application ends by `app.exit()` or a shutdown signal (`shutdownSignals`
 * option): the `onDone()` handlers run, the objects are destroyed, then the process exits.
 *
 * The objects of the application are reached with `@Inject`, or with `app.getObject()`.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 *
 * class Greeter extends Component {
 *     public greet(name: string): string {
 *         return `Hello, ${name}`
 *     }
 * }
 *
 * Application
 *     .env({TZ_NAME: 'Asia/Shanghai'})
 *     .alias({'@data': './data'}, true)
 *     .run(() => ({
 *         id: 'greeter.app',
 *         name: 'Greeter',
 *         components: {
 *             greeter: {class: Greeter}
 *         },
 *         bootstrap: ['greeter']
 *     }))
 *     .onLaunched(async (app, logger): Promise<void> => {
 *         const greeter: Greeter = await app.getObject<Greeter>('greeter')
 *         logger.info(greeter.greet(app.appName))
 *     })
 *     .onDone((app, logger, reason): void => logger.info('Exiting with the code %d', reason.code))
 *     .onFatalException((error, logger): number => {
 *         logger.error(error)
 *         return 2
 *     })
 * ```
 */
export class Application extends Module {

    /**
     * The emitter of the lifecycle events, shared by the application class.
     * @protected
     */
    protected static readonly eventEmitter: SynchronousEventEmitter = new SynchronousEventEmitter()

    /**
     * The application once launched; undefined before, or when its launch failed.
     * @protected
     */
    protected static readonly appInstance: Application | undefined

    /**
     * The environment variables given by `env()`, set at launch.
     * @protected
     */
    protected static readonly environmentVariableMap: Map<string, string> = new Map()

    /**
     * The path aliases given by `alias()`, registered at launch.
     * @protected
     */
    protected static readonly aliasDeclarations: {
        alias: Record<string, string>
        createIfNotExist: boolean
    }[] = []

    /**
     * The options given to `run()`, or the function returning them.
     * @protected
     */
    protected static readonly launchOptions: ApplicationOptions | (() => ApplicationOptions | Promise<ApplicationOptions>)

    /**
     * The timer of the launch, restarted by each call of the fluent API so that a chain launches once.
     * @protected
     */
    protected static launchTimeout: NodeJS.Timeout

    /**
     * Whether the launch of the application started (the calls of the fluent API after it do not launch it again)
     * @protected
     */
    protected static launchStarted: boolean = false

    /**
     * The options preset for the applications, see `preset()`.
     * @protected
     */
    protected static readonly presetOptions: ModuleOptions = {}

    /**
     * The logger of the applications without "log" component
     * @private
     */
    static #consoleLogger: Promise<ILogger> | undefined

    /**
     * Preset the options of the applications, before they run: the packages assembling the framework preset their
     * components (the `lakutata` package presets its Logger as `log` and its Entrypoint as `entrypoint`). An object
     * given to `run()` under a preset name replaces the preset one when it gives its class, or completes its options
     * when it gives none (`log: {level: 'debug'}`); the preset bootstrap steps run first. Each call adds to the preset:
     * its components, providers and named objects replace the preset ones of the same name, its anonymous objects and
     * bootstrap steps are appended. Does not launch the application.
     * @param options The objects and bootstrap steps to preset.
     * @returns The application class, to chain the other calls.
     * @example
     * ```typescript
     * import {Application, Component} from 'lakutata'
     *
     * class Metrics extends Component {
     * }
     *
     * //Every application of this process gets the "metrics" component, started at launch
     * Application.preset({
     *     components: {
     *         metrics: {class: Metrics}
     *     },
     *     bootstrap: ['metrics']
     * })
     * ```
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
     * The logger: the application's `log` component, or a console logger when there is no application or no `log`
     * component.
     * @returns The logger.
     * @protected
     */
    protected static async getLogger(): Promise<ILogger> {
        return this.appInstance ? await this.appInstance.getLogger() : await this.getConsoleLogger()
    }

    /**
     * The console logger ({@link ConsoleLogger}), created once.
     * @returns The console logger.
     * @protected
     */
    protected static getConsoleLogger(): Promise<ILogger> {
        if (!this.#consoleLogger) this.#consoleLogger = new Container().set(ConsoleLogger)
        return this.#consoleLogger
    }

    /**
     * Set environment variables, written to `process.env` at launch, before the options getter given to `run()` is
     * called (it may read them). Each call adds to the previous ones.
     * @param env The variables, by name; the values are strings.
     * @returns The application class, to chain the other calls.
     * @throws {InvalidMethodAcceptException} When a value is not a string.
     */
    @Accept(DTO.Object().pattern(DTO.String(), DTO.String()).required())
    public static env(env: Record<string, string>): typeof Application {
        Object.keys(env).forEach((key: string) => this.environmentVariableMap.set(key, env[key]))
        return this.launch()
    }

    /**
     * Register path aliases at launch: an alias (`@data`) in a path given to `path.resolve()` of Node.js or to
     * `app.alias.resolve()` is replaced with its path. The alias `@runtime` (the working directory) is
     * registered by the application. An invalid alias name (`@` followed by letters and digits only) or an alias
     * registered twice fails the launch (a fatal exception). Each call adds to the previous ones.
     * @param alias The paths, by alias name (`{'@data': '/var/lib/app'}`).
     * @param createIfNotExist Create the directories of the aliases which do not exist; false by default.
     * @returns The application class, to chain the other calls.
     * @throws {InvalidMethodAcceptException} When a path is not a string.
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
     * Add a handler called once the application has launched (its bootstrap completed), or at once when it has
     * launched already. An async handler is not awaited; its rejection is an unhandled rejection.
     * @param handler The function called with the application and its logger.
     * @returns The application class, to chain the other calls.
     */
    public static onLaunched(handler: LaunchedHandler): typeof Application {
        const launched: Application | undefined = this.appInstance
        if (launched) {
            //Added once the application has launched: called at once
            void (async (): Promise<void> => handler(launched, await launched.getLogger()))()
            return this
        }
        this.eventEmitter.once(ApplicationState.Launched, async (app: Application) => handler(app, await app.getLogger()))
        return this.launch()
    }

    /**
     * Add a handler called when the application exits (`app.exit()`, a shutdown signal): it runs, awaited, before the
     * entrypoints stop and the objects are destroyed, the application still working. A handler failing makes the
     * process exit with the code 1.
     * @param handler The function called with the application, its logger and why it exits (its exit code, the
     * signal ending it).
     * @returns The application class, to chain the other calls.
     */
    public static onDone(handler: DoneHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.Done, async (app: Application, reason: ApplicationExitReason) => handler(app, await app.getLogger(), reason))
        return this.launch()
    }

    /**
     * Add a handler of the process' uncaught exceptions (`process.on('uncaughtException')`), the application keeping
     * running. Without handler, the exception is logged as a warning. Every handler added is called.
     * @param handler The function called with the error and the logger.
     * @returns The application class, to chain the other calls.
     */
    public static onUncaughtException(handler: UncaughtExceptionHandler): typeof Application {
        this.eventEmitter.on(ApplicationState.UncaughtException, async (error: Error) => {
            const logger: ILogger = await this.getLogger()
            await handler(error, logger)
        })
        return this.launch()
    }

    /**
     * Set the handler of a fatal exception: an error stopping the launch (invalid options or aliases, an object failing
     * to initialize, a bootstrap step failing). The process exits after it, with the code it returns (1 when it returns
     * none). Without handler, the error is logged and the process exits with the code 1. Only the first handler added
     * is called.
     * @param handler The function called with the error and the logger, returning the exit code.
     * @returns The application class, to chain the other calls.
     */
    public static onFatalException(handler: FatalExceptionHandler): typeof Application {
        this.eventEmitter.once(ApplicationState.FatalException, async (error: Error) => {
            const logger: ILogger = await this.getLogger()
            let exitCode: number | undefined | void = await handler(error, logger)
            if (typeof exitCode !== 'number') exitCode = 1
            return EndProcess(exitCode)
        })
        return this.launch()
    }

    /**
     * Give the application options and launch it (in the next turn of the event loop, once the chain of calls is
     * complete). The options are validated at launch: invalid options are a fatal exception.
     * @param options The application's identity (`id`, `name`), its objects and its bootstrap.
     * @returns The application class, to chain the other calls.
     */
    public static run(options: ApplicationOptions): typeof Application
    /**
     * Give the function returning the application options, called at launch once the environment variables and the
     * aliases are set, and launch the application (in the next turn of the event loop). A getter failing, or invalid
     * options, are a fatal exception.
     * @param optionsGetter The function returning the options, or their promise.
     * @returns The application class, to chain the other calls.
     */
    public static run(optionsGetter: () => ApplicationOptions | Promise<ApplicationOptions>): typeof Application
    public static run(inp: ApplicationOptions | (() => ApplicationOptions | Promise<ApplicationOptions>)): typeof Application {
        Reflect.set(this, 'launchOptions', inp)
        return this.launch()
    }

    /**
     * Schedule the launch for the next turn of the event loop, replacing the launch already scheduled.
     * @returns The application class.
     * @protected
     */
    protected static launch(): typeof Application {
        //Launched once: the calls after its launch started only add their handlers
        if (this.launchStarted) return this
        if (this.launchTimeout) clearTimeout(this.launchTimeout)
        this.launchTimeout = setTimeout((): void => {
            this.launchStarted = true
            process.on('uncaughtException', (error: Error): void => void this.processUncaughtException(error))
            this.launchApplication()
                .then((app: Application): unknown => Reflect.set(this, 'appInstance', app))
                .catch((e: any): void => this.processFatalException(e))
        })
        return this
    }

    /**
     * Handle an uncaught exception: the handlers of `onUncaughtException()`, else a warning of the logger (the console
     * when the logger cannot be got).
     * @param error The uncaught error.
     * @returns Resolves once handled.
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
     * Handle a fatal exception: the handler of `onFatalException()`, else an error of the logger (the console when the
     * logger cannot be got), then the process exits (with the code 1 by default, as Node.js on an uncaught exception):
     * the application cannot run, and the objects already created (a server listening, a connection) would keep the
     * process alive. Ignored once the process is ending.
     * @param error The error.
     * @protected
     */
    protected static processFatalException(error: Error): void {
        //The errors of the code still running once the application is destroyed (it is ending)
        if (IsEnding()) return
        if (!this.eventEmitter.listenerCount(ApplicationState.FatalException)) {
            return process.nextTick(async (): Promise<void> => {
                const exception: Error = new Error('FatalException', {cause: error})
                try {
                    const logger: ILogger = await this.getLogger()
                    logger.error(exception)
                } catch (e) {
                    console.error(exception, e)
                }
                return EndProcess(1)
            })
        }
        this.eventEmitter.emit(ApplicationState.FatalException, error)
    }

    /**
     * End the application gracefully on the signals: its exit (the done handlers, the requests running complete, the
     * objects destroyed, the code 0); a second signal, or a signal received while it launches, ends the process at
     * once with the code 128 + the signal number.
     * @param signals The signals to listen to.
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
     * Launch the application: environment variables, aliases, options (or the database migration command given by the
     * `MIGRATION_*` environment variables), then the application created in a new root container.
     * @returns The application, once its bootstrap has completed.
     * @protected
     */
    protected static async launchApplication(): Promise<Application> {
        this.eventEmitter.once('exit', async (app: Application, exitCode: number, signal?: NodeJS.Signals) => {
            try {
                //The done handler, told why the application exits
                const reason: ApplicationExitReason = signal ? {code: exitCode ? exitCode : 0, signal: signal} : {code: exitCode ? exitCode : 0}
                await this.eventEmitter.emitRequest(ApplicationState.Done, app, reason)
                await rootContainer.destroy()
                EndProcess(exitCode ? exitCode : 0)
            } catch (e) {
                EndProcess(1)
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
                        if (!input[name].options) continue
                        //A copy (the options given are not changed), with the entities given apart to a provider
                        const entities: unknown[] = Array.isArray(input[name].entities) ? input[name].entities : []
                        const own: unknown = input[name].options.entities
                        const dataSourceOptions: Record<string, any> = {
                            ...input[name].options,
                            ...entities.length ? {entities: [...Array.isArray(own) ? own : Object.values(own ?? {}), ...entities]} : {},
                            dataSourceName: name
                        }
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
                    //Resolved once the application is initialized (its objects loaded, its bootstrap run), rejected with
                    //the error of its initialization (a fatal exception)
                    rootContainer
                        .set(Application, {options: applicationOptions})
                        .then(resolve)
                        .catch(reject)
                })
                .catch(reject)
        })
    }

    /**
     * The class reading the application options, which also applies its identity (ID, name, time zone, mode).
     * @protected
     */
    protected ConfigLoader = ApplicationConfigLoader

    /**
     * The application's own declarations: a copy of the preset options (see `preset()`), the options given to `run()`
     * being merged over them.
     * @protected
     */
    protected options: Partial<ApplicationOptions> = Application.copyPresetOptions()

    /**
     * A copy of the preset options, for an application.
     * @returns The copy.
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
     * The logger of the application: its `log` component, or a console logger when it has none.
     * @returns The logger.
     * @protected
     */
    protected async getLogger(): Promise<ILogger> {
        return this.container.has('log') ? As<ILogger>(await this.getObject('log')) : await Application.getConsoleLogger()
    }

    /**
     * The path alias manager, shared by the process: `resolve()` replaces the aliases in a path, `get()`, `set()`,
     * `has()` and `list()` manage them.
     */
    public get alias(): Alias {
        return Alias.getAliasInstance()
    }

    /**
     * The ID of the application (its `id` option), readable before the application is created; "Unknown" until its
     * options are loaded.
     */
    public static get appId(): string {
        return GetAppId()
    }

    /**
     * The name of the application (its `name` option), readable before the application is created; "Unknown" until
     * its options are loaded.
     */
    public static get appName(): string {
        return GetAppName()
    }

    /**
     * The ID of the application (its `id` option).
     */
    public get appId(): string {
        return GetAppId()
    }

    /**
     * The name of the application (its `name` option).
     */
    public get appName(): string {
        return GetAppName()
    }

    /**
     * The time zone of the application: its `timezone` option, or the system's (`auto`); the `TZ` environment
     * variable.
     */
    public get timezone(): string {
        return GetBasicInfo().timezone
    }

    /**
     * The time the process has been running, in seconds (rounded down).
     */
    public get uptime(): number {
        return Math.floor(process.uptime())
    }

    /**
     * Exit the application gracefully: the `onDone()` handlers run, the entrypoints stop (the requests running
     * complete), the objects are destroyed, then the process exits with the code. Returns at once.
     * @param exitCode The exit code of the process (0 for success).
     */
    public exit(exitCode: number): void
    /**
     * Exit the process at once with the code 2, without the done handlers nor the teardown of the objects.
     * @param force true.
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
