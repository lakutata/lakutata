/**
 * A log method: an object (or error) with an optional message, or a message with its format arguments
 */
export interface ILogMethod {
    <T extends object>(obj: T, msg?: string, ...args: any[]): void

    (obj: unknown, msg?: string, ...args: any[]): void

    (msg: string, ...args: any[]): void
}

/**
 * The logger of an application, registered as its "log" component
 */
export interface ILogger {
    error: ILogMethod
    warn: ILogMethod
    info: ILogMethod
    debug: ILogMethod
    trace: ILogMethod
}
