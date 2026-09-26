/**
 * Ported from joi-to-json 5.0.0 test/unit/alternative_try_any.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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

const JOI_OBJ = joi.alternatives().try(joi.number(), joi.string())

const BASE_SCHEMA = {
    anyOf: [
        { type: 'number' },
        { type: 'string' }
    ]
}

const jsonSchema = parse(JOI_OBJ)
const validate = ajv.compile(jsonSchema)

it('alternative try any - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative try any - valid matching any', () => {
    const value = 50
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative try any - valid matching any 2', () => {
    const value = 'kc'
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('alternative try any - invalid matching any', () => {
    const value = true
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})
