/**
 * Ported from joi-to-json 5.0.0 test/unit/logical_combinations.spec.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import joi from '../../../../lib/validation/engine/joi/index.js'
import parse from '../../../../lib/validation/engine/joi-to-json/index.js'
import Ajv from 'ajv/dist/2019.js'
import {toEqual, omit} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const JOI_OBJ = joi.object({
    guid: joi.string(),
    uuid: joi.string(),
    email: joi.string(),
    password: joi.string(),
    type: joi.string(),
    birthTime: joi.string(),
    birthday: joi.string(),
    readOnlyTrue: joi.string(),
    readOnlyFalse: joi.string(),
    writeOnlyTrue: joi.string(),
    writeOnlyFalse: joi.string(),
    genderSpecific: joi.string(),
    maleSpecific: joi.string(),
    ip: joi.string(),
    hostname: joi.string(),
    isAdditional: joi.boolean()
}).or('guid', 'uuid')
    .and('email', 'password', 'type')
    .nand('readOnlyTrue', 'readOnlyFalse')
    .xor('genderSpecific', 'maleSpecific')
    .oxor('ip', 'hostname')
    .with('birthTime', ['birthday'])
    .without('readOnlyTrue', ['writeOnlyTrue', 'writeOnlyFalse'])

const BASE_SCHEMA = {
    'type': 'object',
    'properties': {
        'guid': { 'type': 'string' },
        'uuid': { 'type': 'string' },
        'email': { 'type': 'string' },
        'password': { 'type': 'string' },
        'type': { 'type': 'string' },
        'birthTime': { 'type': 'string' },
        'birthday': { 'type': 'string' },
        'readOnlyTrue': { 'type': 'string' },
        'readOnlyFalse': { 'type': 'string' },
        'writeOnlyTrue': { 'type': 'string' },
        'writeOnlyFalse': { 'type': 'string' },
        'genderSpecific': { 'type': 'string' },
        'maleSpecific': { 'type': 'string' },
        'ip': { 'type': 'string' },
        'hostname': { 'type': 'string' },
        'isAdditional': { 'type': 'boolean' }
    },
    'additionalProperties': false,
    'dependentRequired': {
        'birthTime': [
            'birthday'
        ]
    },
    'allOf': [
        {
            'anyOf': [
                { 'required': ['guid' ] },
                { 'required': ['uuid'] }
            ]
        },
        {
            'oneOf': [
                {
                    'required': ['email', 'password', 'type' ]
                },
                {
                    'allOf': [
                        {
                            'not': { 'required': ['email'] }
                        },
                        {
                            'not': { 'required': ['password'] }
                        },
                        {
                            'not': { 'required': ['type'] }
                        }
                    ]
                }
            ]
        },
        {
            'not': { 'required': ['readOnlyTrue', 'readOnlyFalse'] }
        },
        {
            'if': {
                'propertyNames': {
                    'enum': ['genderSpecific', 'maleSpecific']
                },
                'minProperties': 2
            },
            'then': false,
            'else': {
                'oneOf': [
                    { 'required': ['genderSpecific'] },
                    { 'required': ['maleSpecific'] }
                ]
            }
        },
        {
            'oneOf': [
                { 'required': ['ip'] },
                { 'required': ['hostname'] },
                {
                    'not': {
                        'oneOf': [
                            { 'required': ['ip'] },
                            { 'required': ['hostname'] },
                            { 'required': ['ip', 'hostname'] }
                        ]
                    }
                }
            ]
        },
        {
            'if': {
                'required': [
                    'readOnlyTrue'
                ]
            },
            'then': {
                'not': {
                    'anyOf': [
                        {
                            'required': [
                                'writeOnlyTrue'
                            ]
                        },
                        {
                            'required': [
                                'writeOnlyFalse'
                            ]
                        }
                    ]
                }
            }
        }
    ]
}

it('or - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ genderSpecific: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ uuid: '', genderSpecific: '' })
    expect(!(validate.errors)).to.be.true()
})

it('and - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '', genderSpecific: '', email: '', password: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: '', genderSpecific: '', email: '', password: '', type: '' })
    expect(!(validate.errors)).to.be.true()
})

it('nand - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '', genderSpecific: '', readOnlyTrue: '', readOnlyFalse: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: '', genderSpecific: '', readOnlyTrue: '' })
    expect(!(validate.errors)).to.be.true()
})

it('xor - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: '', maleSpecific: '' })
    expect(!(validate.errors)).to.be.true()
})

it('oxor - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '', maleSpecific: '', ip: '', hostname: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: '', maleSpecific: '', ip: '' })
    expect(!(validate.errors)).to.be.true()
})

it('with - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '', maleSpecific: '', birthTime: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: '', maleSpecific: '', birthTime: '', birthday: '' })
    expect(!(validate.errors)).to.be.true()
})

it('without - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '', maleSpecific: '', readOnlyTrue: '', writeOnlyTrue: '' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: '', maleSpecific: '', readOnlyTrue: '' })
    expect(!(validate.errors)).to.be.true()
})

it('combination - normal', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: '', genderSpecific: '', hostname: '', email: '', password: '', type: '', birthTime: '', birthday: '', readOnlyTrue: '' })
    expect(!(validate.errors)).to.be.true()
})

it('combination - disable all logical convertor', () => {
    const joiObj = JOI_OBJ
    const jsonSchema = parse(joiObj, 'json', {}, { logicalOpParser: false })
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, omit(BASE_SCHEMA, ['allOf', 'dependentRequired']))
    validate({ guid: '', genderSpecific: '', hostname: '', readOnlyFalse: '', email: '', password: '', type: '' })
    expect(!(validate.errors)).to.be.true()
})
