/**
 * Ported from the upstream fixtures-baseline/alternatives.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        conditional: engine.alternatives().conditional('gender', {
            is: 'Male',
            then: engine.string().not('', null),
            otherwise: engine.number().greater(0)
        }),
        conditional_schema: engine.alternatives().conditional(engine.string(), {
            then: engine.string().not('', null),
            otherwise: engine.number().greater(0)
        }).meta({ 'if-style': false }).meta({ 'x-custom': 'test' }),
        conditional_switch: engine.alternatives().conditional('height', {
            switch: [
                { is: 0, then: engine.link('#unifiedString') },
                { is: engine.number().greater(160), then: engine.number() },
                { is: engine.number().greater(300), then: engine.object().keys({ name: engine.string(), level: engine.number() }), otherwise: engine.string() }
            ]
        }),
        match_any: engine.alternatives().try(engine.number(), engine.string()),
        match_all: engine.alternatives().try(engine.number().greater(0), engine.number().less(100)).match('all'),
        match_one: engine.alternatives().try(engine.number(), engine.string()).match('one')
    }
}
