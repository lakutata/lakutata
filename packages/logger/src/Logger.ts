import {Component, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {ILogger} from '@lakutata/core/com/logger'
import {GetAppName} from '@lakutata/core/internal'
import {Stream} from 'node:stream'
import {Bindings, BuildRecord, LEVELS, LogBindings, LogRecord} from './lib/Record.js'
import {Pretty} from './lib/Pretty.js'
import {COLOR_PALETTE, Palette, PLAIN_PALETTE} from './lib/Colors.js'
import {Destination} from './lib/Destination.js'

type Output = {
    destination: Destination
    //The palette of the pretty lines, none for JSON lines
    palette?: Palette
}

//The loggers with buffered lines to write when the process exits
const activeLoggers: Set<Logger> = new Set()

process.once('exit', (): void => activeLoggers.forEach((logger: Logger): void => logger.flush()))

/**
 * Logger component
 * Writes pretty lines ([time] LEVEL (name/pid): message, then the properties), or JSON lines when pretty is off
 */
@Singleton()
export class Logger extends Component implements ILogger {

    /**
     * Format pretty log message, JSON lines otherwise
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly pretty: boolean

    /**
     * Log level
     * @protected
     */
    @Configurable(DTO.String().valid(...Object.keys(LEVELS)).optional().default('trace'))
    protected readonly level: string

    /**
     * If set to true, will add color information to the formatted output message (on stdout only).
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
     * Stream to write to
     * @protected
     */
    @Configurable(DTO.Array(DTO.InstanceOf(Stream)).optional().default(() => [process.stdout]))
    protected readonly destinations: NodeJS.WritableStream[]

    #threshold: number

    #bindings: LogBindings

    #pretty: boolean

    #outputs: Output[]

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#threshold = LEVELS[this.level]
        this.#bindings = Bindings(GetAppName())
        this.#outputs = this.destinations.map((stream: NodeJS.WritableStream): Output => ({
            destination: new Destination(stream, this.sync),
            palette: this.pretty ? (stream === process.stdout && this.colorize ? COLOR_PALETTE : PLAIN_PALETTE) : undefined
        }))
        this.#pretty = this.#outputs.some((output: Output): boolean => !!output.palette)
        activeLoggers.add(this)
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        activeLoggers.delete(this)
        this.flush()
    }

    /**
     * Write a log line
     * @param level
     * @param args
     * @protected
     */
    protected write(level: number, args: unknown[]): void {
        if (level < this.#threshold) return
        const record: LogRecord = BuildRecord(level, this.#bindings, args, this.#pretty)
        let prettyLines: Map<Palette, string> | undefined
        for (const output of this.#outputs) {
            if (!output.palette) {
                output.destination.write(record.line)
                continue
            }
            prettyLines ??= new Map()
            let line: string | undefined = prettyLines.get(output.palette)
            if (line === undefined) {
                //The parsed line is changed by the formatting, it is used once
                line = Pretty(record.line.slice(0, -1), output.palette, prettyLines.size ? undefined : record.log)
                prettyLines.set(output.palette, line)
            }
            output.destination.write(line)
        }
    }

    /**
     * Write the buffered log lines
     */
    public flush(): void {
        this.#outputs?.forEach((output: Output): void => output.destination.flush())
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
        return this.write(50, [obj, ...msg])
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
        return this.write(40, [obj, ...msg])
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
        return this.write(30, [obj, ...msg])
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
        return this.write(20, [obj, ...msg])
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
        return this.write(10, [obj, ...msg])
    }
}
