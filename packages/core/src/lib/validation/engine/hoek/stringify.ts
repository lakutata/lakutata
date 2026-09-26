/**
 * Derived from @hapi/hoek 11.0.7 lib/stringify.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * JSON.stringify() which never throws
 * @param args
 */
export function stringify(...args: Parameters<typeof JSON.stringify>): string {
    try {
        return JSON.stringify(...args)
    } catch (err) {
        return '[Cannot display object: ' + (err as Error).message + ']'
    }
}
