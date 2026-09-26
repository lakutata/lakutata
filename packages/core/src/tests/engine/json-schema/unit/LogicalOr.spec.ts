/**
 * Ported from the upstream test/unit/logical_or.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
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
}).or('a', 'b', 'c')

const BASE_SCHEMA = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    anyOf: [
        { required: ['a'] }, { required: ['b'] }, { required: ['c'] }
    ],
    additionalProperties: false
}

it('or - single field', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi' })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('or - single field with unknown field allown', () => {
    const schemaObj = SCHEMA_OBJ.unknown(true)
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('or - multiple fields', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('or - multiple fields with unknown field allown', () => {
    const schemaObj = SCHEMA_OBJ.unknown(true)
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ a: 'hi', b: 1, e: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})

it('or - missing field', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('or - missing field with unknown field allown', () => {
    const schemaObj = SCHEMA_OBJ.unknown(true)
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ e: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, Object.assign({ }, BASE_SCHEMA, { additionalProperties: true }))
})
