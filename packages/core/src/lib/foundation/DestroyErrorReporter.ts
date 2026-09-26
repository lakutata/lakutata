import {ThrowWarning} from './ThrowWarning.js'

export type DestroyErrorReporter = (error: Error) => void

const defaultDestroyErrorReporter: DestroyErrorReporter = (error: Error): void => {
    ThrowWarning(`An error occurred while destroying an object: ${error.stack ? error.stack : error.message}`)
}

let destroyErrorReporter: DestroyErrorReporter = defaultDestroyErrorReporter

/**
 * Set the reporter for errors raised by cascaded destruction (owner or scope teardown),
 * pass nothing to restore the default reporter (process warning)
 * @param reporter
 * @constructor
 */
export function SetDestroyErrorReporter(reporter?: DestroyErrorReporter): void {
    destroyErrorReporter = reporter ? reporter : defaultDestroyErrorReporter
}

/**
 * Report an error raised by cascaded destruction, a reporter failure never breaks the teardown
 * @param error
 * @constructor
 */
export function ReportDestroyError(error: unknown): void {
    const errors: unknown[] = error instanceof AggregateError ? error.errors : [error]
    for (const item of errors) {
        try {
            destroyErrorReporter(item instanceof Error ? item : new Error(String(item)))
        } catch {
            //A broken reporter must not break the teardown
        }
    }
}
