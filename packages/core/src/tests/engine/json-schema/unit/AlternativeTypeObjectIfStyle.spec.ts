/**
 * Ported from joi-to-json 5.0.0 test/unit/alternative_type_object_if_style.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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
)

const BASE_SCHEMA = {
    if: {
        type: 'object',
        required: ['dynamic'],
        properties: { dynamic: { const: 'kc' } },
        additionalProperties: true
    },
    then: {
        type: 'object',
        properties: { number: { type: 'number' } },
        additionalProperties: true
    },
    else: {
        type: 'object',
        required: ['mustHave'],
        properties: { mustHave: { type: 'boolean' } },
        additionalProperties: false
    }
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('alternative type object if style - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative type object if style - valid matching if', () => {
    const value = { dynamic: 'kc', anything: true }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type object if style - valid matching otherwise', () => {
    const value = { mustHave: true }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type object if style - invalid matching any', () => {
    const value = { something: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
