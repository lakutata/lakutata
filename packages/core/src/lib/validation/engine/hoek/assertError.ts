/**
 * Derived from @hapi/hoek 11.0.7 lib/assertError.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * Error thrown by assert()
 */
export class AssertError extends Error {

    public name: 'AssertError' = 'AssertError'

    constructor(message?: string, ctor?: Function) {
        super(message || 'Unknown error')
        if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, ctor)
    }
}
