/**
 * Ported from joi-to-json 5.0.0 test/unit/alternative_type_object.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.alternatives().conditional(
    engine.object().keys({
        dynamic: engine.string().valid('kc').required()
    }).unknown(true),
    {
        then: engine.object().keys({ number: engine.number() }).unknown(true),
        otherwise: engine.object().keys({
            mustHave: engine.boolean().required()
        })
    }
).meta({ 'if-style': false })

const BASE_SCHEMA = {
    allOf: [
        {
            anyOf: [
                {
                    not: {
                        type: 'object',
                        properties: {
                            dynamic: {
                                'const': 'kc'
                            }
                        },
                        required: [
                            'dynamic'
                        ],
                        additionalProperties: true
                    }
                },
                {
                    type: 'object',
                    properties: {
                        number: {
                            type: 'number'
                        }
                    },
                    additionalProperties: true
                }
            ]
        },
        {
            anyOf: [
                {
                    type: 'object',
                    properties: {
                        dynamic: {
                            'const': 'kc'
                        }
                    },
                    required: [
                        'dynamic'
                    ],
                    additionalProperties: true
                },
                {
                    type: 'object',
                    properties: {
                        mustHave: {
                            type: 'boolean'
                        }
                    },
                    required: [
                        'mustHave'
                    ],
                    additionalProperties: false
                }
            ]
        }
    ]
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('alternative type object - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative type object - valid matching if', () => {
    const value = { dynamic: 'kc', anything: true }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type object - valid matching otherwise', () => {
    const value = { mustHave: true }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type object - invalid matching any', () => {
    const value = { something: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
