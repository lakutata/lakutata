export interface ILogger {
    error<T extends object>(obj: T, msg?: string, ...args: any[]): void

    error(obj: unknown, msg?: string, ...args: any[]): void

    error(msg: string, ...args: any[]): void

    warn<T extends object>(obj: T, msg?: string, ...args: any[]): void

    warn(obj: unknown, msg?: string, ...args: any[]): void

    warn(msg: string, ...args: any[]): void

    info<T extends object>(obj: T, msg?: string, ...args: any[]): void

    info(obj: unknown, msg?: string, ...args: any[]): void

    info(msg: string, ...args: any[]): void

    debug<T extends object>(obj: T, msg?: string, ...args: any[]): void

    debug(obj: unknown, msg?: string, ...args: any[]): void

    debug(msg: string, ...args: any[]): void

    trace<T extends object>(obj: T, msg?: string, ...args: any[]): void

    trace(obj: unknown, msg?: string, ...args: any[]): void

    trace(msg: string, ...args: any[]): void
}
