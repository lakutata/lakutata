import {ILogger} from '../../interfaces/ILogger.js'
import {Component} from '../base/Component.js'
import {Configurable, Singleton} from '../../decorators/DependencyInjectionDecorators.js'
import {Validator} from '../../exports/Validator.js'
import {InjectionProperties} from '../../types/InjectionProperties.js'
import {DefaultLoggerProvider} from '../DefaultLoggerProvider.js'

@Singleton(true)
export class Logger extends Component implements ILogger {

    /**
     * 日志程序提供器
     * 提供器对象须满足ILogger接口
     * @protected
     */
    @Configurable({
        accept: Validator.Object({
            debug: Validator.Function().minArity(1),
            error: Validator.Function().minArity(1),
            fatal: Validator.Function().minArity(1),
            info: Validator.Function().minArity(1),
            trace: Validator.Function().minArity(1),
            warn: Validator.Function().minArity(1)
        }),
        acceptOptions: {
            stripUnknown: false
        }
    })
    protected readonly provider: ILogger = DefaultLoggerProvider()

    protected static METADATA_KEY: symbol = Symbol('LOGGER.METADATA.KEY')

    /**
     * Constructor
     * @param properties
     */
    constructor(properties: InjectionProperties = {}) {
        super(properties)
        Reflect.defineMetadata(Logger.METADATA_KEY, this, Logger)
    }

    protected static getInstance(): Logger {
        if (Reflect.hasOwnMetadata(this.METADATA_KEY, this)) return Reflect.getOwnMetadata(this.METADATA_KEY, this)
        return new this()
    }

    public static error<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public static error(obj: unknown, msg?: string, ...args: any[]): void
    public static error(msg: string, ...args: any[]): void
    public static error(obj: any, ...msg: (any)[]): void {
        return this.getInstance().error(obj, ...msg)
    }

    public static warn<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public static warn(obj: unknown, msg?: string, ...args: any[]): void
    public static warn(msg: string, ...args: any[]): void
    public static warn(obj: any, ...msg: (any)[]): void {
        return this.getInstance().warn(obj, ...msg)
    }

    public static info<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public static info(obj: unknown, msg?: string, ...args: any[]): void
    public static info(msg: string, ...args: any[]): void
    public static info(obj: any, ...msg: (any)[]): void {
        return this.getInstance().info(obj, ...msg)
    }

    public static debug<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public static debug(obj: unknown, msg?: string, ...args: any[]): void
    public static debug(msg: string, ...args: any[]): void
    public static debug(obj: any, ...msg: (any)[]): void {
        return this.getInstance().debug(obj, ...msg)
    }

    public static trace<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public static trace(obj: unknown, msg?: string, ...args: any[]): void
    public static trace(msg: string, ...args: any[]): void
    public static trace(obj: any, ...msg: (any)[]): void {
        return this.getInstance().trace(obj, ...msg)
    }

    public error<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public error(obj: unknown, msg?: string, ...args: any[]): void
    public error(msg: string, ...args: any[]): void
    public error(obj: any, ...msg: (any)[]): void {
        return this.provider.error(obj, ...msg)
    }

    public warn<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public warn(obj: unknown, msg?: string, ...args: any[]): void
    public warn(msg: string, ...args: any[]): void
    public warn(obj: any, ...msg: (any)[]): void {
        return this.provider.warn(obj, ...msg)
    }

    public info<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public info(obj: unknown, msg?: string, ...args: any[]): void
    public info(msg: string, ...args: any[]): void
    public info(obj: any, ...msg: (any)[]): void {
        return this.provider.info(obj, ...msg)
    }

    public debug<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public debug(obj: unknown, msg?: string, ...args: any[]): void
    public debug(msg: string, ...args: any[]): void
    public debug(obj: any, ...msg: (any)[]): void {
        return this.provider.debug(obj, ...msg)
    }

    public trace<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public trace(obj: unknown, msg?: string, ...args: any[]): void
    public trace(msg: string, ...args: any[]): void
    public trace(obj: any, ...msg: (any)[]): void {
        return this.provider.trace(obj, ...msg)
    }
}
