/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/alternatives.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    return {
        conditional: joi.alternatives().conditional('gender', {
            is: 'Male',
            then: joi.string().not('', null),
            otherwise: joi.number().greater(0)
        }),
        conditional_schema: joi.alternatives().conditional(joi.string(), {
            then: joi.string().not('', null),
            otherwise: joi.number().greater(0)
        }).meta({ 'if-style': false }).meta({ 'x-custom': 'test' }),
        conditional_switch: joi.alternatives().conditional('height', {
            switch: [
                { is: 0, then: joi.link('#unifiedString') },
                { is: joi.number().greater(160), then: joi.number() },
                { is: joi.number().greater(300), then: joi.object().keys({ name: joi.string(), level: joi.number() }), otherwise: joi.string() }
            ]
        }),
        match_any: joi.alternatives().try(joi.number(), joi.string()),
        match_all: joi.alternatives().try(joi.number().greater(0), joi.number().less(100)).match('all'),
        match_one: joi.alternatives().try(joi.number(), joi.string()).match('one')
    }
}
