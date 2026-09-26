import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import {DTO} from '../../lib/dto/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {toJsonSchema} from '../../lib/validation/JsonSchema.js'
import type {JSONSchema} from '../../types/JSONSchema.js'

const require: NodeRequire = createRequire(import.meta.url)
const Ajv2020: new (options?: object) => { compile(schema: object): (value: unknown) => boolean } = require('ajv/dist/2020').default
const addFormats: (ajv: object) => void = require('ajv-formats')

class AddressDTO extends DTO {
    @Expect(DTO.String().required())
    public city: string
}

class UserDTO extends DTO {
    @Expect(DTO.String().min(2).max(20).required())
    public name: string

    @Expect(DTO.Number().uint8())
    public age: number

    @Expect(DTO.Number().float())
    public score: number

    @Expect(DTO.String().email().allow(null))
    public email: string | null

    @Expect(AddressDTO.optional())
    public address: AddressDTO
}

/**
 * A validator of a JSON Schema 2020-12
 * @param schema
 */
function compile(schema: JSONSchema): (value: unknown) => boolean {
    const ajv: { compile(schema: object): (value: unknown) => boolean } = new Ajv2020({strict: true})
    addFormats(ajv)
    return ajv.compile(schema)
}

describe('JSON Schema export', (): void => {

    it('converts DTOs into JSON Schema 2020-12 by default', (): void => {
        const schema: JSONSchema = UserDTO.toJsonSchema()
        assert.deepStrictEqual(schema, {
            type: 'object',
            properties: {
                name: {type: 'string', minLength: 2, maxLength: 20},
                age: {type: 'integer', minimum: 0, maximum: 255},
                score: {type: 'number', minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38},
                email: {type: ['string', 'null'], format: 'email'},
                address: {type: 'object', properties: {city: {type: 'string', minLength: 1}}, required: ['city'], additionalProperties: true}
            },
            required: ['name'],
            //lakutata accepts (and strips) the unknown keys
            additionalProperties: true
        })
        const validate: (value: unknown) => boolean = compile(schema)
        assert.ok(validate({name: 'Alice', age: 30, email: null, address: {city: 'Paris'}, extra: 1}))
        assert.ok(!validate({name: 'Alice', age: 300}))
        assert.ok(!validate({name: 'A'}))
        assert.ok(!validate({name: 'Alice', address: {}}))
    })

    it('converts plain schemas for every target', (): void => {
        const schema: ReturnType<typeof DTO.Object> = DTO.Object({id: DTO.Number().int32().required(), tags: DTO.Array().items(DTO.String()).unique()})
        assert.deepStrictEqual(toJsonSchema(schema, {target: 'openapi-3.0'}), {
            type: 'object',
            properties: {
                id: {type: 'integer', minimum: -2147483648, maximum: 2147483647, format: 'int32'},
                tags: {type: 'array', uniqueItems: true, items: {type: 'string', minLength: 1}}
            },
            required: ['id'],
            additionalProperties: true
        })
        assert.strictEqual(toJsonSchema(schema, {dialect: true}).$schema, 'https://json-schema.org/draft/2020-12/schema')
        //Without the validation options of lakutata, unknown keys are rejected
        assert.strictEqual(toJsonSchema(schema, {preferences: {}}).additionalProperties, false)
        assert.deepStrictEqual(UserDTO.toOpenAPIJsonSchema().properties!.age, {type: 'integer', minimum: 0, maximum: 255, format: 'int32'})
    })

    it('rejects values which are not schemas', (): void => {
        assert.throws((): unknown => toJsonSchema({} as never), {name: 'SchemaConversionException'})
    })
})
