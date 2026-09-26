/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/enum.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        extended_enum: joi
            .string()
            .valid('a', 'b', 'c')
            .example('a')
            .example('b')
            .example('c')
            .valid('x', 'y', 'z')
            .example('x')
            .example('y')
            .example('z'),
        enum_override: joi
            .string()
            .valid('a', 'b', 'c')
            .example('a')
            .example('b')
            .example('c')
            .valid(joi.override, 'x', 'y', 'z')
            .example('x', { override: true })
            .example('y')
            .example('z'),
        enum_empty_override: joi
            .string()
            .valid('a', 'b', 'c')
            .valid(joi.override)
    }
}
