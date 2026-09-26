/**
 * Ported from joi-to-json 5.0.0 test/unit/logical_nand.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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
}).nand('a', 'b', 'c')

const BASE_SCHEMA = {
    type: 'object',
    not: { required: ['a', 'b', 'c'] },
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    additionalProperties: false
}

it('nand - none exists', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('nand - none exists with unknown field allown', () => {
    const joiObj = JOI_OBJ.unknown(true)
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('nand - all exists', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1, c: true })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('nand - all exists with unknown field allown', () => {
    const joiObj = JOI_OBJ.unknown(true)
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1, c: true, e: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('nand - some exists', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: '' })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('nand - some exists with unknown field allown', () => {
    const joiObj = JOI_OBJ.unknown(true)
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: '', e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})
