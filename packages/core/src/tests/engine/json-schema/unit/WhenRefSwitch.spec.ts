/**
 * Ported from joi-to-json 5.0.0 test/unit/when_ref_switch.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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
            switch: [
                { is: 'Female', then: engine.number().greater(140).less(180) },
                { is: 'Male', then: engine.number().greater(150).less(200), otherwise: engine.number() }
            ]
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
            'anyOf': [
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
                },
                {
                    'type': 'number'
                }
            ]
        }
    },
    'additionalProperties': false
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('when ref switch - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when ref switch - valid', () => {
    const value = { commonHeightRange: 141, gender: 'Female' }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when ref switch - valid otherwise', () => {
    const value = { commonHeightRange: 0 }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when ref switch - invalid', () => {
    const value = { commonHeightRange: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
