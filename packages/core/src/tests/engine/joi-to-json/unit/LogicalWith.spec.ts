/**
 * Ported from joi-to-json 5.0.0 test/unit/logical_with.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import Ajv from 'ajv/dist/2019.js'
import {toEqual} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const JOI_OBJ = joi.object({
    a: joi.string(),
    b: joi.number(),
    c: joi.boolean(),
    d: joi.number()
}).with('c', ['a']).with('d', ['a', 'b'])

const BASE_SCHEMA = {
    type: 'object',
    dependentRequired: {
        c: ['a'],
        d: ['a', 'b']
    },
    properties: { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' }, d: { type: 'number' } },
    additionalProperties: false
}

it('with - checking property is not present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('with - no dependent properties exists when checking property is present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ d: 1 })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('with - partial dependent properties exists when checking property is present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ d: 1, a: '' })
    expect(!!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('with - all dependent properties exists when checking property is present', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    validate({ d: 1, a: '', b: 1 })
    expect(!(validate.errors)).to.be.true()
    toEqual(jsonSchema, BASE_SCHEMA)
})
