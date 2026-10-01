/**
 * Derived from the upstream lib/assertError.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * Error thrown by assert()
 */
export class AssertError extends Error {

    public name = 'AssertError' as const

    constructor(message?: string, ctor?: Function) {
        super(message || 'Unknown error')
        if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, ctor)
    }
}
