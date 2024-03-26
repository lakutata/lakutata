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

    @Configurable(DTO.String().optional().default('trace'))
    protected readonly level: string

    #instance: PinoLogger

    protected async init(): Promise<void> {
        this.#instance = pino({
            level: this.level,
            name: GetBasicInfo().appName || 'Unnamed'
        }, As(PinoPretty)())
    }

    public error<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public error(obj: unknown, msg?: string, ...args: any[]): void
    public error(msg: string, ...args: any[]): void
    public error(obj: any, ...msg: (any)[]): void {
        return this.#instance.error(obj, ...msg)
    }

    public warn<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public warn(obj: unknown, msg?: string, ...args: any[]): void
    public warn(msg: string, ...args: any[]): void
    public warn(obj: any, ...msg: (any)[]): void {
        return this.#instance.warn(obj, ...msg)
    }

    public info<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public info(obj: unknown, msg?: string, ...args: any[]): void
    public info(msg: string, ...args: any[]): void
    public info(obj: any, ...msg: (any)[]): void {
        return this.#instance.info(obj, ...msg)
    }

    public debug<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public debug(obj: unknown, msg?: string, ...args: any[]): void
    public debug(msg: string, ...args: any[]): void
    public debug(obj: any, ...msg: (any)[]): void {
        return this.#instance.debug(obj, ...msg)
    }

    public trace<T extends object>(obj: T, msg?: string, ...args: any[]): void
    public trace(obj: unknown, msg?: string, ...args: any[]): void
    public trace(msg: string, ...args: any[]): void
    public trace(obj: any, ...msg: (any)[]): void {
        return this.#instance.trace(obj, ...msg)
    }
}
