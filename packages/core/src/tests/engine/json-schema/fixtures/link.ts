/**
 * Ported from the upstream fixtures-baseline/link.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    const unitSchema = engine.object().keys({
        quantity: engine.number().precision(2).positive().greater(0).less(200),
        unit: engine.string().required()
    }).id('unit')
    const unifiedString = engine.string().id('unifiedString')

    return {
        link: engine.object().keys({
            genderSpecific: engine.when('gender', {
                is: 'Female',
                then: engine.number().valid(0, 1, 2).required(),
                otherwise: engine.link('#unifiedString')
            }),
            height: engine.link('#unit').shared(unitSchema),
            heightRank: engine.alternatives().conditional('height', {
                switch: [
                    { is: 0, then: engine.link('#unifiedString') },
                    { is: engine.number().greater(160), then: engine.number() },
                    { is: engine.number().greater(300), then: engine.object().keys({ name: engine.string(), level: engine.number() }), otherwise: engine.string() }
                ]
            }),
            weight: engine.link('#unit').shared(unitSchema),
            children: engine.array().items(engine.link('#person'))
        }).id('person').shared(unifiedString)
    }
}
