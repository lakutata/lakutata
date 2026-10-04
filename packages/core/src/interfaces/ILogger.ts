/**
 * A log method: an object (or error) with an optional message, or a message with its format arguments
 */
export interface ILogMethod {
    <T extends object>(obj: T, msg?: string, ...args: any[]): void

    (obj: unknown, msg?: string, ...args: any[]): void

    (msg: string, ...args: any[]): void
}

/**
 * The logger of an application, registered as its `log` component: the framework logs through it (the lifecycle
 * errors, the uncaught and fatal exceptions) and gives it to the lifecycle handlers. Implemented by the Logger of the
 * `lakutata` package and by the {@link ConsoleLogger} of core.
 */
export interface ILogger {
    /**
     * Log an error: a failure the application needs to act on.
     */
    error: ILogMethod
    /**
     * Log a warning: an unexpected event the application recovers from.
     */
    warn: ILogMethod
    /**
     * Log an information: the normal course of the application.
     */
    info: ILogMethod
    /**
     * Log a debugging detail.
     */
    debug: ILogMethod
    /**
     * Log a tracing detail, finer than debug.
     */
    trace: ILogMethod
}
