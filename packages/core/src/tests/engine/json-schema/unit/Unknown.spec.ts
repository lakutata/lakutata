/**
 * Ported from joi-to-json 5.0.1+ test/unit/unknown.spec.js (commit 8dd0d57, MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ; the result
 * variable, assigned without a declaration upstream, is declared as ES modules are strict). Not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import engine from '../../../../lib/validation/engine/schema/index.js'

// Defaut value of allowUnknown in Engine validate is false

it('unknown_override', () => {
    const engineAllowUnknown = engine.defaults((schema) => schema.options({
        allowUnknown: true
    }))
    const unknown_override = engineAllowUnknown.object().keys({
        inner: engineAllowUnknown.object().keys({
            a: engine.string(),
            innerMost: engine.object().keys({
                c: engine.string(),
                d: engine.string()
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
    const unknown_default = engine.object().keys({
        inner: engine.object().keys({
            a: engine.string(),
            innerMost: engine.object().keys({
                c: engine.string(),
                d: engine.string()
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
