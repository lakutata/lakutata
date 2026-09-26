/**
 * Ported from the upstream fixtures-baseline/default.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (engine) {
    const engineRequired = engine.defaults((schema) => schema.options({
        presence: 'required'
    }))
    const engineAllowUnknown = engine.defaults((schema) => schema.options({
        allowUnknown: true
    }))

    return {
        required: engineRequired.object().keys({
            hash: engineRequired.string(),
            optional: engineRequired.optional()
        }),
        unknown: engineAllowUnknown.object().keys({
            key: engine.string()
        }),
        unknown_override: engineAllowUnknown.object().keys({
            inner: engineAllowUnknown.object().keys({
                a: engine.string(),
                innerMost: engine.object().keys({
                    c: engine.string(),
                    d: engine.string()
                })
            }).unknown(false)
        })
    }
}
