/**
 * Ported from the upstream test/unit/alternative_type_array_if_style.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.alternatives().conditional(
    engine.array().has(engine.any().valid(null)),
    {
        then: engine.array().max(1),
        otherwise: engine.array().max(3)
    }
)

const BASE_SCHEMA = {
    'if': { type: 'array', items: {}, 'contains': { 'const': null } },
    'then': { type: 'array', items: {}, 'maxItems': 1 },
    'else': { type: 'array', items: {}, 'maxItems': 3 }
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('alternative type array if style - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative type array if style - valid matching if', () => {
    const value = [null]
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type array if style - valid matching otherwise', () => {
    const value = [1, 2]
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type array if style - invalid matching if', () => {
    const value = [null, 1]
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative type array if style - invalid matching otherwise', () => {
    const value = [1, 2, 3, 4]
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
