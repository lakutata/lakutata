/**
 * Ported from the upstream fixtures-baseline/date.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        iso: engine.date().iso(),
        timestamp: engine.date().timestamp('unix')
    }
}
