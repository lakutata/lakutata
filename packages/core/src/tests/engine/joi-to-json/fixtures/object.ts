/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/object.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        length: joi.object().length(3),
        or: joi.object().keys({
            'guid': joi.string(),
            'uuid': joi.string()
        }).or('guid', 'uuid'),
        and: joi.object().keys({
            'email': joi.string(),
            'password': joi.string(),
            'type': joi.string()
        }).and('email', 'password', 'type'),
        nand: joi.object().keys({
            'readOnlyTrue': joi.string(),
            'readOnlyFalse': joi.string()
        }).nand('readOnlyTrue', 'readOnlyFalse'),
        xor: joi.object().keys({
            'genderSpecific': joi.string(),
            'maleSpecific': joi.string()
        }).xor('genderSpecific', 'maleSpecific'),
        with: joi.object().keys({
            'birthTime': joi.string(),
            'birthday': joi.string()
        }).with('birthTime', ['birthday']),
        without: joi.object().keys({
            'readOnlyTrue': joi.string(),
            'readOnlyFalse': joi.string(),
            'writeOnlyTrue': joi.string(),
            'writeOnlyFalse': joi.string()
        }).without('readOnlyTrue', ['writeOnlyTrue', 'writeOnlyFalse']),
        oxor: joi.object().keys({
            'ip': joi.string(),
            'hostname': joi.string()
        }).oxor('ip', 'hostname'),
        minMax: joi.object().min(4).max(12),
        pattern: joi.object()
            .pattern(/s/, joi.object().keys({
                id: joi
                    .number()
                    .required(),
                name: joi
                    .string()
                    .allow('', null)
                    .required()
            }))
            .pattern(/a/, joi.array().items(joi.string())),
        unknown_false: joi.object().unknown(false),
        unknown_true: joi.object().unknown(true)
    }
}
