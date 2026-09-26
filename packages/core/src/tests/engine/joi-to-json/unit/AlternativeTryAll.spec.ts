/**
 * Ported from joi-to-json 5.0.0 test/unit/alternative_try_all.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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

const JOI_OBJ = joi.alternatives().try(
    joi.number().greater(100),
    joi.number().less(200)
).match('all')

const BASE_SCHEMA = {
    allOf: [
        { type: 'number', minimum: 100, exclusiveMinimum: 100 },
        { type: 'number', maximum: 200, exclusiveMaximum: 200 }
    ]
}

const jsonSchema = parse(JOI_OBJ)
const validate = ajv.compile(jsonSchema)

it('alternative try all - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative try all - valid matching both', () => {
    const value = 150
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative try all - invalid matching one', () => {
    const value = 300
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative try all - invalid matching one 2', () => {
    const value = 80
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative try all - invalid matching none', () => {
    const value = true
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})
