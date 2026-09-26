/**
 * Ported from joi-to-json 5.0.0 test/unit/when_ref_is_then.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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
    commonHeightRange: engine.number().when('gender', {
        is: 'Female',
        then: engine.number().greater(140).less(180),
        otherwise: engine.number().greater(150).less(200)
    })
})

const BASE_SCHEMA = {
    'type': 'object',
    'properties': {
        'gender': {
            'type': 'string'
        },
        'commonHeightRange': {
            'type': 'number',
            'oneOf': [
                {
                    'type': 'number',
                    'exclusiveMinimum': 140,
                    'minimum': 140,
                    'exclusiveMaximum': 180,
                    'maximum': 180
                },
                {
                    'type': 'number',
                    'exclusiveMinimum': 150,
                    'minimum': 150,
                    'exclusiveMaximum': 200,
                    'maximum': 200
                }
            ]
        }
    },
    'additionalProperties': false
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('when ref is then - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when ref is then - valid', () => {
    const value = { commonHeightRange: 141, gender: 'Female' }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when ref is then - invalid', () => {
    const value = { commonHeightRange: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
