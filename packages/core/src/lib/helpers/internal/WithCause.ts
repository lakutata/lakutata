/**
 * Set the cause of an exception (the error it wraps) and return the exception
 * @param exception
 * @param cause
 */
export function WithCause<T extends Error>(exception: T, cause: unknown): T {
    exception.cause = cause
    return exception
}
