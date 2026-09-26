/**
 * Ported from joi-to-json 5.0.0 fixtures-baseline/default.js (MIT, see THIRD_PARTY_NOTICES.md)
 * The schemas whose descriptions are the baseline of the parser tests. Not type-checked.
 */
// @ts-nocheck
export default function (joi) {
    const joiRequired = joi.defaults((schema) => schema.options({
        presence: 'required'
    }))
    const joiAllowUnknown = joi.defaults((schema) => schema.options({
        allowUnknown: true
    }))

    return {
        required: joiRequired.object().keys({
            hash: joiRequired.string(),
            optional: joiRequired.optional()
        }),
        unknown: joiAllowUnknown.object().keys({
            key: joi.string()
        }),
        unknown_override: joiAllowUnknown.object().keys({
            inner: joiAllowUnknown.object().keys({
                a: joi.string(),
                innerMost: joi.object().keys({
                    c: joi.string(),
                    d: joi.string()
                })
            }).unknown(false)
        })
    }
}
