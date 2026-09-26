/**
 * Ported from the upstream test/unit/alternative_try_with_only_one_option.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.alternatives().try(engine.number())

const BASE_SCHEMA = { type: 'number' }

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema)

it('alternative try with only one option - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('alternative try with only one option - valid matching one', () => {
    const value = 50
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('alternative try with only one option - invalid matching none', () => {
    const value = true
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
