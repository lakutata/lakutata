/**
 * Ported from joi-to-json 5.0.0 test/unit/alternative_type_array.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import Ajv from 'ajv'
import {toEqual} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const JOI_OBJ = joi.alternatives().conditional(
    joi.array().has(joi.any().valid(null)),
    {
        then: joi.array().max(1),
        otherwise: joi.array().max(3)
    }
).meta({ 'if-style': false })

const BASE_SCHEMA = {
    allOf: [
        {
            anyOf: [
                { not: { type: 'array', items: {}, 'contains': { 'const': null } } },
                { type: 'array', items: {}, maxItems: 1 }
            ]
        },
        {
            anyOf: [
                { type: 'array', items: {}, 'contains': { 'const': null } },
                { type: 'array', items: {}, 'maxItems': 3 }
            ]
        }
    ]
}

const jsonSchema = parse(JOI_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('alternative type array - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative type array - valid matching if', () => {
    const value = [null]
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative type array - valid matching otherwise', () => {
    const value = [1, 2]
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative type array - invalid matching if', () => {
    const value = [null, 1]
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative type array - invalid matching otherwise', () => {
    const value = [1, 2, 3, 4]
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})
