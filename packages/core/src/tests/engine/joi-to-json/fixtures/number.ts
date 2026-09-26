/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/number.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        greaterLess: joi.number().greater(0).less(200),
        integer: joi.number().integer(),
        integer_const: joi.number().integer().valid(1),
        minMax: joi.number().integer().min(6).max(21),
        multiple: joi.number().multiple(10),
        negative: joi.number().negative(),
        positive: joi.number().positive(),
        precision: joi.number().precision(2)
    }
}
