/**
 * Ported from joi-to-json 5.0.0 test/unit/logical_xor.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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

const JOI_OBJ = joi.object({
    a: joi.string(),
    b: joi.number(),
    c: joi.boolean(),
    d: joi.number()
}).xor('a', 'b', 'c')

const BASE_SCHEMA = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    if: { propertyNames: { enum: ['a', 'b', 'c'] }, minProperties: 2 },
    then: false,
    else: {
        oneOf: [
            {
                required: ['a']
            },
            {
                required: ['b']
            },
            {
                required: ['c']
            }
        ]
    },
    additionalProperties: false
}

it('xor - single field', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi' })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('xor - single field with unknown field allown', () => {
    const joiObj = JOI_OBJ.unknown(true)
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('xor - multiple fields', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('xor - multiple fields with unknown field allown', () => {
    const joiObj = JOI_OBJ.unknown(true)
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1, e: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('xor - missing field', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('xor - missing field with unknown field allown', () => {
    const joiObj = JOI_OBJ.unknown(true)
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ e: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})
