class Warning extends Error {
    public get name(): string {
        return this.constructor.name
    }
}

/**
 * Throw warning message through process
 * @param message
 * @constructor
 */
export function ThrowWarning(message: string): boolean {
    return process.emit('warning', new Warning(message))
}
