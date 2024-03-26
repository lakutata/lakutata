import {Component} from '../lib/core/Component.js'
import {Singleton} from '../decorators/di/Lifetime.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'
import {pino, Logger as PinoLogger} from 'pino'
import {GetBasicInfo} from '../lib/base/internal/BasicInfo.js'
import PinoPretty from 'pino-pretty'
import {As} from '../lib/functions/As.js'

/**
 * Logger component
 */
@Singleton()
export class Logger extends Component {

    /**
     * Format pretty log message
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly pretty: boolean

    /**
     * Log level
     * @protected
     */
    @Configurable(DTO.String().optional().default('trace'))
    protected readonly level: string

    /**
     * If set to true, will add color information to the formatted output message.
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly colorize: boolean

    /**
     * Makes messaging synchronous.
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly sync: boolean

    /**
     * Pino logger instance
     * @private
     */
    #instance: PinoLogger

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#instance = pino({
            level: this.level,
            name: GetBasicInfo().appName || 'Unnamed'
        }, As(PinoPretty)({
            colorize: this.colorize,
            sync: this.sync
        }))
    }

    /**
     * Write a 'error' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public error<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Write a 'error' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public error(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Write a 'error' level log, if the configured level allows for it.
     * @param msg
     * @param args
     */
    public error(msg: string, ...args: any[]): void
    public error(obj: any, ...msg: (any)[]): void {
        return this.#instance.error(obj, ...msg)
    }

    /**
     * Write a 'warn' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public warn<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Write a 'warn' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public warn(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Write a 'warn' level log, if the configured level allows for it.
     * @param msg
     * @param args
     */
    public warn(msg: string, ...args: any[]): void
    public warn(obj: any, ...msg: (any)[]): void {
        return this.#instance.warn(obj, ...msg)
    }

    /**
     * Write a 'info' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public info<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Write a 'info' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public info(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Write a 'info' level log, if the configured level allows for it.
     * @param msg
     * @param args
     */
    public info(msg: string, ...args: any[]): void
    public info(obj: any, ...msg: (any)[]): void {
        return this.#instance.info(obj, ...msg)
    }

    /**
     * Write a 'debug' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public debug<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Write a 'debug' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public debug(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Write a 'debug' level log, if the configured level allows for it.
     * @param msg
     * @param args
     */
    public debug(msg: string, ...args: any[]): void
    public debug(obj: any, ...msg: (any)[]): void {
        return this.#instance.debug(obj, ...msg)
    }

    /**
     * Write a 'trace' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public trace<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Write a 'trace' level log, if the configured level allows for it.
     * @param obj
     * @param msg
     * @param args
     */
    public trace(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Write a 'trace' level log, if the configured level allows for it.
     * @param msg
     * @param args
     */
    public trace(msg: string, ...args: any[]): void
    public trace(obj: any, ...msg: (any)[]): void {
        return this.#instance.trace(obj, ...msg)
    }
}
