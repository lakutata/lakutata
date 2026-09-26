/**
 * Ported from joi-to-json 5.0.0 test/unit/logical_nand.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.object({
    a: engine.string(),
    b: engine.number(),
    c: engine.boolean(),
    d: engine.number()
}).nand('a', 'b', 'c')

const BASE_SCHEMA = {
    type: 'object',
    not: { required: ['a', 'b', 'c'] },
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    additionalProperties: false
}

it('nand - none exists', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('nand - none exists with unknown field allown', () => {
    const schemaObj = SCHEMA_OBJ.unknown(true)
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('nand - all exists', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1, c: true })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('nand - all exists with unknown field allown', () => {
    const schemaObj = SCHEMA_OBJ.unknown(true)
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1, c: true, e: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('nand - some exists', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: '' })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('nand - some exists with unknown field allown', () => {
    const schemaObj = SCHEMA_OBJ.unknown(true)
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: '', e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})
