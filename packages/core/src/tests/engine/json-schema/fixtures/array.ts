/**
 * Ported from the upstream fixtures-baseline/array.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        has: engine.array().items(engine.string()).has(engine.string().valid('kc', 'ws')),
        length: engine.array().items(engine.string()).length(2),
        minMax: engine.array().items(engine.string()).min(1).max(3)
    }
}
