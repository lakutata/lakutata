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
 * Flatten aggregated errors, keeping the message of every enclosing aggregate as context
 * @param error
 * @param context
 */
function flatten(error: unknown, context?: string): Error[] {
    if (error instanceof AggregateError) return error.errors.flatMap((item: unknown): Error[] => flatten(item, error.message))
    const item: Error = error instanceof Error ? error : new Error(String(error))
    return [context ? new Error(`${context}: ${item.message}`, {cause: item}) : item]
}

/**
 * Report an error raised by cascaded destruction, a reporter failure never breaks the teardown
 * @param error
 * @param objectName name of the object whose teardown failed
 * @constructor
 */
export function ReportDestroyError(error: unknown, objectName?: string): void {
    const context: string | undefined = objectName && !(error instanceof AggregateError) ? `Failed to destroy object "${objectName}"` : undefined
    for (const item of flatten(error, context)) {
        try {
            destroyErrorReporter(item)
        } catch {
            //A broken reporter must not break the teardown
        }
    }
}
