/**
 * Ported from joi-to-json 5.0.0 test/unit/when_type_object_if_style.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import Ajv from 'ajv'
import {toEqual} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const JOI_OBJ = joi.object().keys({
        dynamic: joi.any().allow(null)
    })
    .unknown(true)
    .when(
        joi.object().keys({
            dynamic: joi.string().valid('kc').required()
        }).unknown(true),
        {
            then: joi.object().keys({ number: joi.number() }).unknown(true),
            otherwise: joi.object().keys({
                mustHave: joi.boolean().required()
            })
        }
    )

const BASE_SCHEMA = {
    type: 'object',
    properties: {
        dynamic: {
            type: ['array', 'boolean', 'number', 'object', 'string', 'null']
        }
    },
    additionalProperties: true,
    if: {
        type: 'object',
        required: ['dynamic'],
        properties: { dynamic: { const: 'kc' } },
        additionalProperties: true
    },
    then: {
        type: 'object',
        properties: { number: { type: 'number' } },
        additionalProperties: true
    },
    else: {
        type: 'object',
        required: ['mustHave'],
        properties: { mustHave: { type: 'boolean' } },
        additionalProperties: false
    }
}

const jsonSchema = parse(JOI_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('when type object if style - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when type object if style - valid matching if', () => {
    const value = { dynamic: 'kc', anything: true }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('when type object if style - valid matching otherwise', () => {
    const value = { mustHave: true }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('when type object if style - invalid matching any', () => {
    const value = { something: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})
