/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/object.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        length: engine.object().length(3),
        or: engine.object().keys({
            'guid': engine.string(),
            'uuid': engine.string()
        }).or('guid', 'uuid'),
        and: engine.object().keys({
            'email': engine.string(),
            'password': engine.string(),
            'type': engine.string()
        }).and('email', 'password', 'type'),
        nand: engine.object().keys({
            'readOnlyTrue': engine.string(),
            'readOnlyFalse': engine.string()
        }).nand('readOnlyTrue', 'readOnlyFalse'),
        xor: engine.object().keys({
            'genderSpecific': engine.string(),
            'maleSpecific': engine.string()
        }).xor('genderSpecific', 'maleSpecific'),
        with: engine.object().keys({
            'birthTime': engine.string(),
            'birthday': engine.string()
        }).with('birthTime', ['birthday']),
        without: engine.object().keys({
            'readOnlyTrue': engine.string(),
            'readOnlyFalse': engine.string(),
            'writeOnlyTrue': engine.string(),
            'writeOnlyFalse': engine.string()
        }).without('readOnlyTrue', ['writeOnlyTrue', 'writeOnlyFalse']),
        oxor: engine.object().keys({
            'ip': engine.string(),
            'hostname': engine.string()
        }).oxor('ip', 'hostname'),
        minMax: engine.object().min(4).max(12),
        pattern: engine.object()
            .pattern(/s/, engine.object().keys({
                id: engine
                    .number()
                    .required(),
                name: engine
                    .string()
                    .allow('', null)
                    .required()
            }))
            .pattern(/a/, engine.array().items(engine.string())),
        unknown_false: engine.object().unknown(false),
        unknown_true: engine.object().unknown(true)
    }
}
