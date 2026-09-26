/**
 * Ported from joi-to-json 5.0.0 test/unit/logical_without.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/schema/index.js'
import parse from '../../../../lib/validation/engine/json-schema/index.js'
import Ajv from 'ajv'
import {toEqual} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const JOI_OBJ = joi.object({
    a: joi.string(),
    b: joi.number(),
    c: joi.boolean(),
    d: joi.number()
}).without('a', ['b', 'c'])

const BASE_SCHEMA = {
    type: 'object',
    if: { required: ['a'] },
    then: {
        not: {
            anyOf: [{ required: ['b'] }, { required: ['c'] }]
        }
    },
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    additionalProperties: false
}

it('without - checking property is not present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ b: 1, c: true })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('without - no dependent properties exists when checking property is present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: '' })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('without - dependent property exists when checking property is present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: '', b: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})
