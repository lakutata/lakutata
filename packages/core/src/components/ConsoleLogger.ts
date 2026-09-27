import {formatWithOptions} from 'node:util'
import {Component} from '../lib/core/Component.js'
import {Singleton} from '../decorators/di/Lifetime.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/dto/DTO.js'
import {GetAppName} from '../lib/foundation/BasicInfo.js'
import {ILogger} from '../interfaces/ILogger.js'

const LEVELS: Record<string, number> = {trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: Infinity}

/**
 * The logger of a core-only application, writing plain lines to the console
 * The lakutata package replaces it with its Logger component
 */
@Singleton()
export class ConsoleLogger extends Component implements ILogger {

    /**
     * Log level
     * @protected
     */
    @Configurable(DTO.String().valid(...Object.keys(LEVELS)).optional().default('info'))
    protected readonly level: string

    /**
     * Write a log line
     * @param level
     * @param args
     * @protected
     */
    protected write(level: string, args: unknown[]): void {
        if (LEVELS[level] < LEVELS[this.level]) return
        const [first, ...rest] = args
        //An object comes before its message, as in the structured loggers
        const parts: unknown[] = typeof first === 'object' && first !== null && typeof rest[0] === 'string' ? [...rest, first] : args
        const line: string = `[${new Date().toISOString()}] ${level.toUpperCase()} (${GetAppName()}): ${formatWithOptions({colors: false}, ...parts)}\n`
        LEVELS[level] >= LEVELS.warn ? process.stderr.write(line) : process.stdout.write(line)
    }

    public error(...args: any[]): void {
        this.write('error', args)
    }

    public warn(...args: any[]): void {
        this.write('warn', args)
    }

    public info(...args: any[]): void {
        this.write('info', args)
    }

    public debug(...args: any[]): void {
        this.write('debug', args)
    }

    public trace(...args: any[]): void {
        this.write('trace', args)
    }
}
