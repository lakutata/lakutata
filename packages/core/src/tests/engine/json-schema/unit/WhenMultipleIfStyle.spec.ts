/**
 * Ported from the upstream test/unit/when_multiple_if_style.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
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

const SCHEMA_OBJ = engine.object().keys({
    key: engine.string(),
    another: engine.string()
}).unknown()
.when(engine.object().keys({ key: engine.string().valid('xxx') }).unknown(),
    { then: engine.object().keys({ key1: engine.string().required() }).unknown() }
).when(engine.object().keys({ key: engine.string().valid('yyy') }).unknown(),
    { then: engine.object().keys({ key2: engine.string().required() }).unknown() }
).when(engine.object().keys({ another: engine.string().valid('zzz') }).unknown(),
    { then: engine.object().keys({ key3: engine.string().required() }).unknown() }
)

const BASE_SCHEMA = {
    'type': 'object',
    'properties': {
        'key': {
            'type': 'string',
            'minLength': 1
        },
        'another': {
            'type': 'string',
            'minLength': 1
        }
    },
    additionalProperties: true,
    allOf: [
        {
            if: {
                type: 'object',
                properties: { key: { const: 'xxx' } },
                additionalProperties: true
            },
            then: {
                type: 'object',
                required: ['key1'],
                properties: { key1: { type: 'string', minLength: 1 } },
                additionalProperties: true
            }
        },
        {
            if: {
                type: 'object',
                properties: { key: { const: 'yyy' } },
                additionalProperties: true
            },
            then: {
                type: 'object',
                required: ['key2'],
                properties: { key2: { type: 'string', minLength: 1 } },
                additionalProperties: true
            }
        },
        {
            if: {
                type: 'object',
                properties: { another: { const: 'zzz' } },
                additionalProperties: true
            },
            then: {
                type: 'object',
                required: ['key3'],
                properties: { key3: { type: 'string', minLength: 1 } },
                additionalProperties: true
            }
        }
    ]
}

const jsonSchema = parse(SCHEMA_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('when multiple if style - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when multiple if style - valid matching all of the condition', () => {
    const value = { key: 'xxx', key1: 'kc', another: 'zzz', key3: 'ws' }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when multiple if style - valid matching one of the condition', () => {
    const value = { key: 'yyy', key2: 'kc' }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when multiple if style - invalid matching one of the condition', () => {
    const value = { key: 'xxx' }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})

it('when multiple if style - invalid matching none', () => {
    const value = { something: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(SCHEMA_OBJ.validate(value).error)).to.be.true()
})
