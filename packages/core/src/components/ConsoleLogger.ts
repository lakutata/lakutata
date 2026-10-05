import {formatWithOptions} from 'node:util'
import {Component} from '../lib/core/Component.js'
import {Singleton} from '../decorators/di/Lifetime.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/dto/DTO.js'
import {getAppName} from '../lib/foundation/BasicInfo.js'
import {ILogger} from '../interfaces/ILogger.js'

const LEVELS: Record<string, number> = {trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: Infinity}

/**
 * The logger of a core-only application, writing plain lines to the console:
 * `[<ISO time>] <LEVEL> (<application name>): <message>`, formatted as `util.format()` (an object given before its
 * message is written after it); the warnings and errors to stderr, the other levels to stdout. The application uses it
 * when it has no `log` component; register it as `log` to configure its level. The `lakutata` package replaces it with
 * its Logger component.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {ConsoleLogger} from '@lakutata/core/com/logger'
 *
 * Application.run({
 *     id: 'tool.app',
 *     name: 'Tool',
 *     components: {
 *         log: {class: ConsoleLogger, level: 'debug'}
 *     }
 * }).onLaunched((app, logger): void => logger.debug({pid: process.pid}, 'Launched'))
 * ```
 */
@Singleton()
export class ConsoleLogger extends Component implements ILogger {

    /**
     * The lowest level written: `trace`, `debug`, `info`, `warn`, `error`, or `silent` for none.
     * @default 'info'
     * @protected
     */
    @Configurable(DTO.String().valid(...Object.keys(LEVELS)).optional().default('info'))
    protected readonly level: string

    /**
     * Write a log line, unless its level is below the configured one.
     * @param level The level of the line (`trace`, `debug`, `info`, `warn`, `error`).
     * @param args An object (or error) and its message, or a message and its format arguments.
     * @protected
     */
    protected write(level: string, args: unknown[]): void {
        if (LEVELS[level] < LEVELS[this.level]) return
        const [first, ...rest] = args
        //An object comes before its message, as in the structured loggers
        const parts: unknown[] = typeof first === 'object' && first !== null && typeof rest[0] === 'string' ? [...rest, first] : args
        const line: string = `[${new Date().toISOString()}] ${level.toUpperCase()} (${getAppName()}): ${formatWithOptions({colors: false}, ...parts)}\n`
        LEVELS[level] >= LEVELS.warn ? process.stderr.write(line) : process.stdout.write(line)
    }

    /**
     * Log an error to stderr.
     * @param args An object (or error) and its message, or a message and its format arguments.
     */
    public error(...args: any[]): void {
        this.write('error', args)
    }

    /**
     * Log a warning to stderr.
     * @param args An object (or error) and its message, or a message and its format arguments.
     */
    public warn(...args: any[]): void {
        this.write('warn', args)
    }

    /**
     * Log an information to stdout.
     * @param args An object (or error) and its message, or a message and its format arguments.
     */
    public info(...args: any[]): void {
        this.write('info', args)
    }

    /**
     * Log a debugging detail to stdout (written when the level is `debug` or `trace`).
     * @param args An object (or error) and its message, or a message and its format arguments.
     */
    public debug(...args: any[]): void {
        this.write('debug', args)
    }

    /**
     * Log a tracing detail to stdout (written when the level is `trace`).
     * @param args An object (or error) and its message, or a message and its format arguments.
     */
    public trace(...args: any[]): void {
        this.write('trace', args)
    }
}
