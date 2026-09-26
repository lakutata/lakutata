/**
 * Derived from @hapi/pinpoint 2.0.1 lib/index.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

export interface Location {
    /**
     * The fully qualified filename
     */
    readonly filename: string
    /**
     * The file line number
     */
    readonly line: number
}

/**
 * Get the filename and line number of a caller in the call stack
 * @param depth distance from the location function in the call stack, defaults to 0 (location's caller)
 */
export function location(depth: number = 0): Location {
    const orig: typeof Error.prepareStackTrace = Error.prepareStackTrace
    Error.prepareStackTrace = (_error: Error, stack: NodeJS.CallSite[]): NodeJS.CallSite[] => stack
    const capture: { stack?: NodeJS.CallSite[] } = {}
    //No constructor: like upstream, the frame of location() itself is kept
    Error.captureStackTrace(capture)
    const line: NodeJS.CallSite = (capture.stack as NodeJS.CallSite[])[depth + 1]
    Error.prepareStackTrace = orig
    return {
        filename: line.getFileName() as string,
        line: line.getLineNumber() as number
    }
}
