/**
 * Ported from joi-to-json 5.0.0 test/unit/when_multiple.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
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
    key: joi.string(),
    another: joi.string()
}).unknown()
.when(joi.object().keys({ key: joi.string().valid('xxx') }).unknown(),
    { then: joi.object().keys({ key1: joi.string().required() }).unknown() }
).when(joi.object().keys({ key: joi.string().valid('yyy') }).unknown(),
    { then: joi.object().keys({ key2: joi.string().required() }).unknown() }
).when(joi.object().keys({ another: joi.string().valid('zzz') }).unknown(),
    { then: joi.object().keys({ key3: joi.string().required() }).unknown() }
).meta({ 'if-style': false })

const BASE_SCHEMA = {
    'type': 'object',
    'properties': {
        'key': {
            'type': 'string'
        },
        'another': {
            'type': 'string'
        }
    },
    'additionalProperties': true,
    'allOf': [
        {
            'anyOf': [
                {
                    not: {
                        'type': 'object',
                        'properties': {
                            'key': {
                                'const': 'xxx'
                            }
                        },
                        'additionalProperties': true
                    }
                },
                {
                    'type': 'object',
                    'properties': {
                        'key1': {
                            'type': 'string'
                        }
                    },
                    'required': [
                        'key1'
                    ],
                    'additionalProperties': true
                }
            ]
        },
        {
            'anyOf': [
                {
                    not: {
                        'type': 'object',
                        'properties': {
                            'key': {
                                'const': 'yyy'
                            }
                        },
                        'additionalProperties': true
                    }
                },
                {
                    'type': 'object',
                    'properties': {
                        'key2': {
                            'type': 'string'
                        }
                    },
                    'required': [
                        'key2'
                    ],
                    'additionalProperties': true
                }
            ]
        },
        {
            'anyOf': [
                {
                    not: {
                        'type': 'object',
                        'properties': {
                            'another': {
                                'const': 'zzz'
                            }
                        },
                        'additionalProperties': true
                    }
                },
                {
                    'type': 'object',
                    'properties': {
                        'key3': {
                            'type': 'string'
                        }
                    },
                    'required': [
                        'key3'
                    ],
                    'additionalProperties': true
                }
            ]
        }
    ]
}

const jsonSchema = parse(JOI_OBJ)
const validate = ajv.compile(jsonSchema, { allowUnionTypes: true })

it('when multiple - valid schema', () => {
    toEqual(jsonSchema, BASE_SCHEMA)
})

it('when multiple - valid matching all of the condition', () => {
    const value = { key: 'xxx', key1: 'kc', another: 'zzz', key3: 'ws' }
    validate(value)
    expect(!(validate.errors)).to.be.true()
    expect(!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('when multiple - valid matching one of the condition', () => {
    const value = { key: 'yyy', key2: 'kc' }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('when multiple - invalid matching one of the condition', () => {
    const value = { key: 'xxx' }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})

it('when multiple - invalid matching none', () => {
    const value = { something: false }
    validate(value)
    expect(!!(validate.errors)).to.be.true()
    expect(!!(JOI_OBJ.validate(value).error)).to.be.true()
})
