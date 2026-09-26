/**
 * Ported from joi-to-json 5.0.1+ test/unit/unknown.spec.js (commit 8dd0d57, MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ; the result
 * variable, assigned without a declaration upstream, is declared as ES modules are strict). Not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/joi/index.js'

// Defaut value of allowUnknown in Joi validate is false

it('unknown_override', () => {
    const joiAllowUnknown = joi.defaults((schema) => schema.options({
        allowUnknown: true
    }))
    const unknown_override = joiAllowUnknown.object().keys({
        inner: joiAllowUnknown.object().keys({
            a: joi.string(),
            innerMost: joi.object().keys({
                c: joi.string(),
                d: joi.string()
            })
        }).unknown(false)
    })


    let result = unknown_override.validate({ inner: {}, outerExtra: 'outerExtra' })
    expect(!(result.error)).to.be.true()
    result = unknown_override.validate({ inner: { a: 'a', innerMost: { c: 'c', d: 'd' }, innerExtra: 'inner' } })
    expect(!!(result.error)).to.be.true()
    result = unknown_override.validate({ inner: { a: 'a', innerMost: { c: 'c', innerMostExtra: 'innerMost' }} })
    expect(!(result.error)).to.be.true()
})

it('unknown_default', () => {
    const unknown_default = joi.object().keys({
        inner: joi.object().keys({
            a: joi.string(),
            innerMost: joi.object().keys({
                c: joi.string(),
                d: joi.string()
            })
        }).unknown(false)
    })

    let result = unknown_default.validate({ inner: {}, outerExtra: 'outerExtra' })
    expect(!!(result.error)).to.be.true()
    result = unknown_default.validate({ inner: { a: 'a', innerMost: { c: 'c', d: 'd' }, innerExtra: 'inner' } })
    expect(!!(result.error)).to.be.true()
    result = unknown_default.validate({ inner: { a: 'a', innerMost: { c: 'c', innerMostExtra: 'innerMost' } } })
    expect(!!(result.error)).to.be.true()
})
