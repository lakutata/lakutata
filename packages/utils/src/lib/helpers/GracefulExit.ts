import {DevNull} from './DevNull.js'

/**
 * Terminate the program gracefully, after the functions given
 * @param exitCode
 * @param functions
 * @constructor
 */
export function GracefulExit(exitCode: number, ...functions: (() => any)[]): void {
    //The errors of the functions are ignored
    setImmediate((): void => void (async (): Promise<void> => {
        for (const func of functions) {
            try {
                await func()
            } catch (e) {
                DevNull(e)
            }
        }
        process.exit(exitCode)
    })())
}
