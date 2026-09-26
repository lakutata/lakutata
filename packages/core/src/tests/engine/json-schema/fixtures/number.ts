/**
 * Ported from the upstream fixtures-baseline/number.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        greaterLess: engine.number().greater(0).less(200),
        integer: engine.number().integer(),
        integer_const: engine.number().integer().valid(1),
        minMax: engine.number().integer().min(6).max(21),
        multiple: engine.number().multiple(10),
        negative: engine.number().negative(),
        positive: engine.number().positive(),
        precision: engine.number().precision(2)
    }
}
