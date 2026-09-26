/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/boolean.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        insensitive_falsy: engine.boolean().falsy('N', 'No').sensitive(false),
        insensitive_truthy: engine.boolean().truthy('Y', 'Yes').sensitive(false),
        sensitive_falsy: engine.boolean().falsy('N', 'No').sensitive(true),
        sensitive_truthy: engine.boolean().truthy('Y', 'Yes').sensitive(true)
    }
}
