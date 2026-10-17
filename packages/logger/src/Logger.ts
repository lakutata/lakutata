import {Application, Component, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {ILogger} from '@lakutata/core/com/logger'
import {Stream} from 'node:stream'
import {logBindings, buildRecord, LEVELS, LogBindings, LogRecord} from './lib/Record.js'
import {REDACTED_HEADERS} from './lib/Serializers.js'
import {pretty} from './lib/Pretty.js'
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
 * The logger component of the applications built with `lakutata`: the package presets it as the `log` component (and
 * creates it first), so the framework and the application log through it. It writes the pino log format: one JSON
 * object per line, with `level` (10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal), `time` (milliseconds since the epoch),
 * `pid`, `hostname`, `name` (the application's name), the properties of the logged object and `msg`; with `pretty` on
 * (the default), it writes readable lines instead: `[HH:MM:ss.SSS] LEVEL (name/pid): message`, then one indented line
 * per property, in the local time zone.
 *
 * Configure it through the `log` entry of the application's `components` (no `class` needed:
 * `log: {level: 'info', pretty: false}`), and get it with `@Inject('log')` or `getObject('log')`; it is a singleton.
 * The lines are buffered and written at the next turn of the event loop (or once 16 KB are pending), and the pending
 * lines are written synchronously when the process exits or the component is destroyed; `sync: true` writes each line
 * at once instead. A stream with a file descriptor (stdout, stderr, an opened file) is written synchronously through
 * it, so the lines keep their order.
 *
 * An HTTP request or response logged as the object of a line is written under `req` or `res` with the values of its
 * credential headers (`Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`) replaced by `[Redacted]` (see
 * the `redactedHeaders` option). Nothing else is redacted and there are no child loggers: the other properties are
 * written as is, so log the fields you need rather than secrets or whole objects holding them.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {Logger} from 'lakutata/com/logger'
 *
 * class Orders extends Component {
 *     @Inject('log')
 *     protected readonly log: Logger
 *
 *     public pay(orderId: number, amount: number): void {
 *         //{"level":30,...,"orderId":42,"msg":"order 42 paid: 9.90"}
 *         this.log.info({orderId: orderId}, 'order %d paid: %s', orderId, amount.toFixed(2))
 *     }
 *
 *     public fail(error: Error): void {
 *         //The error serialized under "err", its message as the message unless one is given
 *         this.log.error(error, 'payment failed')
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     components: {
 *         //The preset logger: JSON lines from the info level in production
 *         log: {level: 'info', pretty: process.env.NODE_ENV !== 'production'},
 *         orders: {class: Orders}
 *     }
 * }))
 * ```
 */
@Singleton()
export class Logger extends Component implements ILogger {

    /**
     * Write readable lines (`[HH:MM:ss.SSS] LEVEL (name/pid): message`, then the properties) when `true`, the JSON lines
     * of pino when `false` (for a log collector).
     * @default true
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly pretty: boolean

    /**
     * The lowest level written: `'trace'`, `'debug'`, `'info'`, `'warn'`, `'error'`, `'fatal'` (only the lines of
     * {@link Logger.fatal}) or `'silent'` (nothing); the lines of lower levels are dropped.
     * @default 'trace'
     * @protected
     */
    @Configurable(DTO.String().valid(...Object.keys(LEVELS)).optional().default('trace'))
    protected readonly level: string

    /**
     * Color the readable lines written to `process.stdout` (the level, the message, the properties); the other
     * destinations and the JSON lines are never colored.
     * @default true when the standard output is a terminal and the `NO_COLOR` environment variable is not set (a
     * standard output redirected to a file or a pipe gets no escape codes)
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default((): boolean => !!process.stdout.isTTY && !process.env.NO_COLOR))
    protected readonly colorize: boolean

    /**
     * Write each line at once when `true`; when `false`, the lines are buffered and written at the next turn of the
     * event loop (or once 16 KB are pending), which costs less per line. The pending lines are written synchronously when
     * the process exits either way.
     * @default false
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly sync: boolean

    /**
     * The streams the lines are written to, each receiving every line: `process.stdout`, `process.stderr`, a file
     * (`fs.createWriteStream(path, {flags: 'a'})`) or any writable stream. The streams are not closed by the logger.
     * @default [process.stdout]
     * @protected
     */
    @Configurable(DTO.Array(DTO.InstanceOf(Stream)).optional().default(() => [process.stdout]))
    protected readonly destinations: NodeJS.WritableStream[]

    /**
     * The headers whose values are written as `[Redacted]` when an HTTP request or response (of `node:http`, Express,
     * Fastify) is logged as the object of a line, by name (case-insensitive). The list replaces the default one: to
     * redact another header, list the default ones with it; `[]` writes every header as is. The headers of the request
     * or response are not changed.
     * @default ['authorization', 'cookie', 'set-cookie', 'proxy-authorization']
     * @protected
     */
    @Configurable(DTO.Array(DTO.String()).optional().default(() => [...REDACTED_HEADERS]))
    protected readonly redactedHeaders: string[]

    #threshold: number

    #bindings: LogBindings

    #pretty: boolean

    #outputs: Output[]

    #redacted: ReadonlySet<string>

    /**
     * Set up the destinations and the level, and register the logger to flush its pending lines when the process exits.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#threshold = LEVELS[this.level]
        this.#bindings = logBindings(Application.appName)
        this.#redacted = new Set(this.redactedHeaders.map((name: string): string => name.toLowerCase()))
        this.#outputs = this.destinations.map((stream: NodeJS.WritableStream): Output => ({
            destination: new Destination(stream, this.sync),
            palette: this.pretty ? (stream === process.stdout && this.colorize ? COLOR_PALETTE : PLAIN_PALETTE) : undefined
        }))
        this.#pretty = this.#outputs.some((output: Output): boolean => !!output.palette)
        activeLoggers.add(this)
    }

    /**
     * Write the pending lines and stop flushing at the process exit.
     * @protected
     */
    protected async destroy(): Promise<void> {
        activeLoggers.delete(this)
        this.flush()
    }

    /**
     * Build a log line and write it to every destination, unless its level is below the configured `level`.
     * @param level The numeric level of the line: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
     * @param args The arguments of the log method: `[obj, msg, ...args]` or `[msg, ...args]`.
     * @protected
     */
    protected write(level: number, args: unknown[]): void {
        if (level < this.#threshold) return
        const record: LogRecord = buildRecord(level, this.#bindings, args, this.#pretty, this.#redacted)
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
                line = pretty(record.line.slice(0, -1), output.palette, prettyLines.size ? undefined : record.log)
                prettyLines.set(output.palette, line)
            }
            output.destination.write(line)
        }
    }

    /**
     * Write the buffered lines now, synchronously for the streams with a file descriptor (before a `process.exit()`
     * in a signal handler, for instance). Does nothing with `sync: true`.
     */
    public flush(): void {
        this.#outputs?.forEach((output: Output): void => output.destination.flush())
    }

    /**
     * Log a fatal error (a failure the application cannot continue after, logged before it exits) at the `fatal`
     * level (60), unless the configured `level` is `'silent'`. The line and the pending ones are written at once, as
     * by {@link Logger.flush}.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public fatal<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Log a fatal error (a failure the application cannot continue after, logged before it exits) at the `fatal`
     * level (60), unless the configured `level` is `'silent'`. The line and the pending ones are written at once, as
     * by {@link Logger.flush}.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public fatal(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Log a fatal error (a failure the application cannot continue after, logged before it exits) at the `fatal`
     * level (60), unless the configured `level` is `'silent'`. The line and the pending ones are written at once, as
     * by {@link Logger.flush}.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public fatal(msg: string, ...args: any[]): void
    public fatal(obj: any, ...msg: (any)[]): void {
        this.write(60, [obj, ...msg])
        //The process may end without a turn of the event loop
        this.flush()
    }

    /**
     * Log an error (a failure the application needs to act on) at the `error` level (50), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public error<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Log an error (a failure the application needs to act on) at the `error` level (50), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public error(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Log an error (a failure the application needs to act on) at the `error` level (50), unless the configured `level` is higher.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public error(msg: string, ...args: any[]): void
    public error(obj: any, ...msg: (any)[]): void {
        return this.write(50, [obj, ...msg])
    }

    /**
     * Log a warning (an unexpected event the application recovers from) at the `warn` level (40), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public warn<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Log a warning (an unexpected event the application recovers from) at the `warn` level (40), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public warn(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Log a warning (an unexpected event the application recovers from) at the `warn` level (40), unless the configured `level` is higher.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public warn(msg: string, ...args: any[]): void
    public warn(obj: any, ...msg: (any)[]): void {
        return this.write(40, [obj, ...msg])
    }

    /**
     * Log an information (the normal course of the application) at the `info` level (30), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public info<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Log an information (the normal course of the application) at the `info` level (30), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public info(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Log an information (the normal course of the application) at the `info` level (30), unless the configured `level` is higher.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public info(msg: string, ...args: any[]): void
    public info(obj: any, ...msg: (any)[]): void {
        return this.write(30, [obj, ...msg])
    }

    /**
     * Log a debugging detail at the `debug` level (20), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public debug<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Log a debugging detail at the `debug` level (20), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public debug(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Log a debugging detail at the `debug` level (20), unless the configured `level` is higher.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public debug(msg: string, ...args: any[]): void
    public debug(obj: any, ...msg: (any)[]): void {
        return this.write(20, [obj, ...msg])
    }

    /**
     * Log a tracing detail, finer than debug at the `trace` level (10), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public trace<T extends object>(obj: T, msg?: string, ...args: any[]): void
    /**
     * Log a tracing detail, finer than debug at the `trace` level (10), unless the configured `level` is higher.
     * @param obj The properties added to the line (`{orderId: 42}`). An `Error` is written under `err` (its type,
     * message, stack, causes and own properties), its message becoming the message when `msg` is omitted; an HTTP
     * request or response of `node:http` is written under `req` or `res`, its credential headers redacted.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public trace(obj: unknown, msg?: string, ...args: any[]): void
    /**
     * Log a tracing detail, finer than debug at the `trace` level (10), unless the configured `level` is higher.
     * @param msg The message, with printf-style placeholders replaced by `args`: `%s` (string), `%d` and `%f` (number),
     * `%i` (integer), `%o`, `%O` and `%j` (JSON), `%%` (a percent sign).
     * @param args The values of the placeholders of `msg`, in order; the values without a placeholder are dropped.
     */
    public trace(msg: string, ...args: any[]): void
    public trace(obj: any, ...msg: (any)[]): void {
        return this.write(10, [obj, ...msg])
    }
}
