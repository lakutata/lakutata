import {DevNull} from './DevNull.js'

/**
 * Terminate program graceful
 * @param exitCode
 * @param functions
 * @constructor
 */
export function GraceExit(exitCode: number, ...functions: (() => any)[]): void {
    setImmediate(async (): Promise<void> => {
        for (const func of functions) {
            try {
                await func()
            } catch (e) {
                DevNull(e)
            }
        }
        process.exit(exitCode)
    })
}
