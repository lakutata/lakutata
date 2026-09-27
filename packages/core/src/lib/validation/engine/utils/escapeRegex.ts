/**
 * Derived from the upstream lib/escapeRegex.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * Escape a string for use in a regular expression: ^$.*+-?=!:|\/()[]{},
 * @param string
 */
export function escapeRegex(string: string): string {
    return string.replace(/[\^\$\.\*\+\-\?\=\!\:\|\\\/\(\)\[\]\{\}\,]/g, '\\$&')
}
