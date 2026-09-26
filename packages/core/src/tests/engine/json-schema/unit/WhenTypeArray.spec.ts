/**
 * Ported from the upstream test/unit/when_type_array.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.array()
    .items(engine.any())
    .when(
        engine.array().has(engine.any().valid(null)),
        {
            then: engine.array().max(1),
            otherwise: engine.array().max(3)
        }
    ).meta({ 'if-style': false })

const BASE_SCHEMA = {
    type: 'array',
    items: {
        'type': ['array', 'boolean', 'number', 'object', 'string', 'null']
    },
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

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('when type array - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when type array - valid matching if', () => {
    const value = [null]
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when type array - valid matching otherwise', () => {
    const value = [1, 2]
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when type array - invalid matching if', () => {
    const value = [null, 1]
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when type array - invalid matching otherwise', () => {
    const value = [1, 2, 3, 4]
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
