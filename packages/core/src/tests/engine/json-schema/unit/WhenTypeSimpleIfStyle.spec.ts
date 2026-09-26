/**
 * Ported from joi-to-json 5.0.0 test/unit/when_type_simple_if_style.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.number().when(
    engine.number().multiple(10),
    {
        then: engine.number().max(100),
        otherwise: engine.number().max(9)
    }
)

const BASE_SCHEMA = {
    'type': 'number',
    'if': { 'multipleOf': 10, type: 'number' },
    'then': { 'maximum': 100, type: 'number' },
    'else': { 'maximum': 9, type: 'number' }
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema)

it('when type simple if style - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when type simple if style - valid matching if', () => {
    const value = 50
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when type simple if style - valid matching otherwise', () => {
    const value = 8
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when type simple if style - invalid matching if', () => {
    const value = 110
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when type simple if style - invalid matching otherwise', () => {
    const value = 19
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
