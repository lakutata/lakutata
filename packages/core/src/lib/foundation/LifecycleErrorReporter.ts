import {throwWarning} from './ThrowWarning.js'

/**
 * A reporter of the errors of the lifecycle of the objects which have no caller to throw them to: the errors of a
 * cascaded destruction (owner or scope teardown) and of the launched() hooks
 */
export type LifecycleErrorReporter = (error: Error, message: string) => void

const defaultLifecycleErrorReporter: LifecycleErrorReporter = (error: Error, message: string): void => {
    throwWarning(`${message}: ${error.stack ? error.stack : error.message}`)
}

let lifecycleErrorReporter: LifecycleErrorReporter = defaultLifecycleErrorReporter

/**
 * Set the reporter of the errors of the lifecycle of the objects, pass nothing to restore the default reporter
 * (process warning)
 * @param reporter
 * @constructor
 */
export function setLifecycleErrorReporter(reporter?: LifecycleErrorReporter): void {
    lifecycleErrorReporter = reporter ? reporter : defaultLifecycleErrorReporter
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
 * Report errors, a reporter failure never breaks the lifecycle
 * @param errors
 * @param message
 */
function report(errors: Error[], message: string): void {
    for (const error of errors) {
        try {
            lifecycleErrorReporter(error, message)
        } catch {
            //A broken reporter must not break the lifecycle
        }
    }
}

/**
 * Report an error raised by cascaded destruction
 * @param error
 * @param objectName name of the object whose teardown failed
 * @constructor
 */
export function reportDestroyError(error: unknown, objectName?: string): void {
    const context: string | undefined = objectName && !(error instanceof AggregateError) ? `Failed to destroy object "${objectName}"` : undefined
    report(flatten(error, context), 'An error occurred while destroying an object')
}

/**
 * Report an error raised by the launched() hook of an object
 * @param error
 * @param objectName
 * @constructor
 */
export function reportLaunchedError(error: unknown, objectName: string): void {
    report(flatten(error, `Failed to run the launched() hook of object "${objectName}"`), 'An error occurred in the launched() hook of an object')
}
