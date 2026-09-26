/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/array.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        has: joi.array().items(joi.string()).has(joi.string().valid('kc', 'ws')),
        length: joi.array().items(joi.string()).length(2),
        minMax: joi.array().items(joi.string()).min(1).max(3)
    }
}
