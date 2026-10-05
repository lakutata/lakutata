import {DevNull} from './DevNull.js'

/**
 * Exit the process once cleanup functions have run. The call returns at once; on the next turn of the event loop
 * (`setImmediate`) the functions are called one after the other, each awaited before the next, then `process.exit()`
 * is called with the exit code. An error thrown or a promise rejected by a function is ignored and the next function
 * still runs; a function whose promise never settles keeps the process from exiting.
 * @param exitCode The exit code of the process: `0` for a success, another integer for a failure.
 * @param functions The cleanup functions, synchronous or asynchronous, in the order they run; none exits directly.
 * @example
 * ```typescript
 * import {gracefulExit} from 'lakutata/utils'
 *
 * declare function closeDatabase(): Promise<void>
 *
 * process.once('SIGTERM', (): void => gracefulExit(0, closeDatabase, (): void => console.log('Bye')))
 * ```
 */
export function gracefulExit(exitCode: number, ...functions: (() => any)[]): void {
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
