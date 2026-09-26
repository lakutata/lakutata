/**
 * Ported from joi-to-json 5.0.0 test/unit/multiple_shared.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import Joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import {toEqual} from '../support.js'

it('Multiple shared schemas should be included correctly.', () => {
    const shared1 = Joi.string().valid('Something-1').id('Something-1')
    const shared2 = Joi.string().valid('Something-2').id('Something-2')

    const schemaUsingShared = Joi.object({
        random: Joi.link('#Something-2'),
        random2: Joi.link('#Something-1')
    })
        .shared(shared1)
        .shared(shared2)

    const result = {
        'type': 'object',
        'properties': {
            'random': { '$ref': '#/$defs/Something-2' },
            'random2': { '$ref': '#/$defs/Something-1' }
        },
        'additionalProperties': false,
        '$defs': {
            'Something-1': { 'const': 'Something-1' },
            'Something-2': { 'const': 'Something-2' }
        }
    }

    toEqual(parse(schemaUsingShared), result)
})
