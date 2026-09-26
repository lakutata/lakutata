/**
 * Ported from the upstream test/unit/alternative_type_simple.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
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
    engine.number().multiple(10),
    {
        then: engine.number().max(100),
        otherwise: engine.number().max(9)
    }
).meta({ 'if-style': false })

const BASE_SCHEMA = {
    allOf: [
        {
            anyOf: [
                { not: { type: 'number', 'multipleOf': 10 } },
                { type: 'number', 'maximum': 100 }
            ]
        },
        {
            anyOf: [
                { type: 'number', 'multipleOf': 10 },
                { 'maximum': 9, type: 'number' }
            ]
        }
    ]
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema)

it('alternatives type simple - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternatives type simple - valid matching if', () => {
    const value = 50
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternatives type simple - valid matching otherwise', () => {
    const value = 8
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternatives type simple - invalid matching if', () => {
    const value = 110
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternatives type simple - invalid matching otherwise', () => {
    const value = 19
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
