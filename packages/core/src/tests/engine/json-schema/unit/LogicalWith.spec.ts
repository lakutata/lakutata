/**
 * Ported from the upstream test/unit/logical_with.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import engine from '../../../../lib/validation/engine/schema/index.js'
import parse from '../../../../lib/validation/engine/json-schema/index.js'
import Ajv from 'ajv/dist/2019.js'
import {toEqual} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const SCHEMA_OBJ = engine.object({
    a: engine.string(),
    b: engine.number(),
    c: engine.boolean(),
    d: engine.number()
}).with('c', ['a']).with('d', ['a', 'b'])

const BASE_SCHEMA = {
    type: 'object',
    dependencies: {
        c: ['a'],
        d: ['a', 'b']
    },
    properties: { a: { type: 'string', minLength: 1 }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    additionalProperties: false
}

it('with - checking property is not present', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('with - no dependent properties exists when checking property is present', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ d: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('with - partial dependent properties exists when checking property is present', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ d: 1, a: 'x' })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('with - all dependent properties exists when checking property is present', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    validate({ d: 1, a: 'x', b: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})
