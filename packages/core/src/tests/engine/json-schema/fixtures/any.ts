/**
 * Ported from the upstream fixtures-baseline/any.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    return {
        allow: engine.string().allow('', null),
        default: engine.any().default('Male'),
        description: engine.any().description('Hero Nickname'),
        example: engine.any().example('鹄思乱想'),
        forbidden: engine.forbidden(),
        id: engine.any().id('person'),
        meta: engine.any().meta({ 'x-expandable': true, 'x-lookup': 'name', 'z-ignore': true, format: 'custom_format', 'x-supported-lang': ['zh-CN', 'en-US'], deprecated: true, readOnly: false, writeOnly: true, title: 'This is title' }),
        shared: engine.any().shared(engine.string().id('unifiedString')),
        valid: engine.any().valid('Male', 'Female', 0, 1, '', null),
        when_multiple: engine.object().keys({
            key: engine.string()
        }).unknown()
        .when(engine.object().keys({ key: engine.valid('xxx') }).unknown(),
            { then: engine.object().keys({ key1: engine.string().required() }).unknown() }
        ).when(engine.object().keys({ key: engine.valid('yyy') }).unknown(),
            { then: engine.object().keys({ key2: engine.string().required() }).unknown() }
        ).meta({ 'if-style': false }),
        when_is: engine.any().when('gender', {
            is: 'Female',
            then: engine.number().valid(0, 1, 2).required(),
            otherwise: engine.string()
        }),
        when_not: engine.any().when('gender', {
            not: 'Female',
            then: engine.number().valid(0, 1, 2).required(),
            otherwise: engine.boolean()
        }),
        when_switch: engine.any().when('gender', {
            switch: [
                { is: 0, then: engine.string() },
                { is: engine.number().greater(160), then: engine.number() },
                { is: engine.number().greater(300), then: engine.object().keys({ name: engine.string(), level: engine.number() }), otherwise: engine.string() }
            ]
        })
    }
}
