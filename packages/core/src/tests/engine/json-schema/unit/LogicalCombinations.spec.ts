/**
 * Ported from the upstream test/unit/logical_combinations.spec.js (see UPSTREAM.md; MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the assertions and the code style differ).
 * It exercises dynamic inputs, so it is not type-checked.
 */
// @ts-nocheck
import {it} from 'node:test'
import {expect} from '../../support/Expect.js'
import engine from '../../../../lib/validation/engine/schema/index.js'
import parse from '../../../../lib/validation/engine/json-schema/index.js'
import Ajv from 'ajv/dist/2019.js'
import {toEqual, omit} from '../support.js'

const ajv = new Ajv({ allErrors: true })

const SCHEMA_OBJ = engine.object({
    guid: engine.string(),
    uuid: engine.string(),
    email: engine.string(),
    password: engine.string(),
    type: engine.string(),
    birthTime: engine.string(),
    birthday: engine.string(),
    readOnlyTrue: engine.string(),
    readOnlyFalse: engine.string(),
    writeOnlyTrue: engine.string(),
    writeOnlyFalse: engine.string(),
    genderSpecific: engine.string(),
    maleSpecific: engine.string(),
    ip: engine.string(),
    hostname: engine.string(),
    isAdditional: engine.boolean()
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
        'guid': { 'type': 'string', 'minLength': 1 },
        'uuid': { 'type': 'string', 'minLength': 1 },
        'email': { 'type': 'string', 'minLength': 1 },
        'password': { 'type': 'string', 'minLength': 1 },
        'type': { 'type': 'string', 'minLength': 1 },
        'birthTime': { 'type': 'string', 'minLength': 1 },
        'birthday': { 'type': 'string', 'minLength': 1 },
        'readOnlyTrue': { 'type': 'string', 'minLength': 1 },
        'readOnlyFalse': { 'type': 'string', 'minLength': 1 },
        'writeOnlyTrue': { 'type': 'string', 'minLength': 1 },
        'writeOnlyFalse': { 'type': 'string', 'minLength': 1 },
        'genderSpecific': { 'type': 'string', 'minLength': 1 },
        'maleSpecific': { 'type': 'string', 'minLength': 1 },
        'ip': { 'type': 'string', 'minLength': 1 },
        'hostname': { 'type': 'string', 'minLength': 1 },
        'isAdditional': { 'type': 'boolean' }
    },
    'additionalProperties': false,
    'dependencies': {
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
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ genderSpecific: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ uuid: 'x', genderSpecific: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('and - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x', genderSpecific: 'x', email: 'x', password: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: 'x', genderSpecific: 'x', email: 'x', password: 'x', type: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('nand - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x', genderSpecific: 'x', readOnlyTrue: 'x', readOnlyFalse: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: 'x', genderSpecific: 'x', readOnlyTrue: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('xor - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: 'x', maleSpecific: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('oxor - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x', maleSpecific: 'x', ip: 'x', hostname: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: 'x', maleSpecific: 'x', ip: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('with - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x', maleSpecific: 'x', birthTime: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: 'x', maleSpecific: 'x', birthTime: 'x', birthday: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('without - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x', maleSpecific: 'x', readOnlyTrue: 'x', writeOnlyTrue: 'x' })
    expect(!!(validate.errors)).to.be.true()
    validate({ guid: 'x', maleSpecific: 'x', readOnlyTrue: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('combination - normal', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj)
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, BASE_SCHEMA)
    validate({ guid: 'x', genderSpecific: 'x', hostname: 'x', email: 'x', password: 'x', type: 'x', birthTime: 'x', birthday: 'x', readOnlyTrue: 'x' })
    expect(!(validate.errors)).to.be.true()
})

it('combination - disable all logical convertor', () => {
    const schemaObj = SCHEMA_OBJ
    const jsonSchema = parse(schemaObj, 'json', {}, { logicalOpParser: false })
    const validate = ajv.compile(jsonSchema)

    toEqual(jsonSchema, omit(BASE_SCHEMA, ['allOf', 'dependencies']))
    validate({ guid: 'x', genderSpecific: 'x', hostname: 'x', readOnlyFalse: 'x', email: 'x', password: 'x', type: 'x' })
    expect(!(validate.errors)).to.be.true()
})
