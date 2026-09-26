/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/date.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        iso: joi.date().iso(),
        timestamp: joi.date().timestamp('unix')
    }
}
