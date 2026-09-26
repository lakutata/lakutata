/**
 * Ported from the upstream test/unit/alternative_ref_is_then.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import engine from '../../../../lib/validation/engine/schema/index.js'
import parse from '../../../../lib/validation/engine/json-schema/index.js'
import Ajv from 'ajv'
import {toEqual} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const SCHEMA_OBJ = engine.object().keys({
    gender: engine.string(),
    commonHeightRange: engine.alternatives().conditional('gender', {
        is: 'Female',
        then: engine.number().greater(140).less(180),
        otherwise: engine.number().greater(150).less(200)
    })
})

const BASE_SCHEMA = {
    'type': 'object',
    'properties': {
        'gender': {
            'type': 'string',
            'minLength': 1
        },
        'commonHeightRange': {
            'anyOf': [
                {
                    'type': 'number',
                    'exclusiveMinimum': 140,
                    'exclusiveMaximum': 180
                },
                {
                    'type': 'number',
                    'exclusiveMinimum': 150,
                    'exclusiveMaximum': 200
                }
            ]
        }
    },
    'additionalProperties': false
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('alternative ref is then - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative ref is then - valid', () => {
    const value = { commonHeightRange: 141, gender: 'Female' }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative ref is then - invalid', () => {
    const value = { commonHeightRange: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
