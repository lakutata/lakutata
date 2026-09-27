/**
 * Derived from the upstream lib/assert.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {AssertError} from './assertError.js'
import {stringify} from './stringify.js'

/**
 * Throw an AssertError (or the given error) when the condition is falsy
 * @param condition
 * @param args message parts (strings, errors or values to stringify), or a single error to throw
 */
export function assert(condition: unknown, ...args: unknown[]): asserts condition {
    if (condition) return
    if (args.length === 1 && args[0] instanceof Error) throw args[0]
    const msgs: string[] = args
        .filter((arg: unknown): boolean => arg !== '')
        .map((arg: unknown): string => typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : stringify(arg))
    throw new AssertError(msgs.join(' '), assert)
}
