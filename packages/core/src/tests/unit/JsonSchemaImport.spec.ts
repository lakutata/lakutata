import {describe, it} from 'node:test'
import assert from 'node:assert'
import {DTO} from '../../lib/dto/DTO.js'
import {fromJsonSchema, toJsonSchema} from '../../lib/validation/JsonSchema.js'
import type {Schema} from '../../lib/validation/types/Schema.js'
import type {JSONSchema} from '../../types/JSONSchema.js'
import type {Base} from '../../lib/validation/engine/schema/base.js'

/**
 * Whether a schema accepts a value (with the validation options of lakutata)
 * @param schema
 * @param value
 */
function accepts(schema: Schema, value: unknown): boolean {
    return DTO.isValid(value, schema)
}

describe('JSON Schema import', (): void => {

    it('validates like JSON Schema, without conversion', (): void => {
        const schema: Schema = fromJsonSchema({type: 'object', properties: {n: {type: 'number'}}, required: ['n']})
        assert.ok(accepts(schema, {n: 1, extra: true}))
        assert.ok(!accepts(schema, {n: '1'}))
        assert.ok(!accepts(schema, {}))
        //The unknown keys are kept, not stripped
        assert.deepStrictEqual(DTO.validate({n: 1, extra: true}, schema), {n: 1, extra: true})
        assert.ok(!accepts(fromJsonSchema({type: 'object', additionalProperties: false}), {a: 1}))
        //Opt-in conversion
        assert.ok(accepts(fromJsonSchema({type: 'number'}, {convert: true}), '1'))
    })

    it('resolves the references, recursive ones included', (): void => {
        const tree: Schema = fromJsonSchema({
            $ref: '#/$defs/node',
            $defs: {node: {type: 'object', properties: {value: {type: 'number'}, children: {type: 'array', items: {$ref: '#/$defs/node'}}}, required: ['value']}}
        })
        assert.ok(accepts(tree, {value: 1, children: [{value: 2, children: [{value: 3}]}]}))
        assert.ok(!accepts(tree, {value: 1, children: [{value: 2, children: [{}]}]}))
        const anchored: Schema = fromJsonSchema({$defs: {name: {$anchor: 'name', type: 'string'}}, properties: {a: {$ref: '#name'}}})
        assert.ok(!accepts(anchored, {a: 1}))
        const external: Schema = fromJsonSchema({$ref: 'https://example.com/id.json'}, {schemas: {'https://example.com/id.json': {type: 'integer'}}})
        assert.ok(accepts(external, 1) && !accepts(external, 1.5))
        assert.throws((): unknown => fromJsonSchema({$ref: '#/$defs/missing'}), {name: 'SchemaConversionException'})
    })

    it('reads OpenAPI documents', (): void => {
        const document: Record<string, unknown> = {
            openapi: '3.0.3',
            components: {
                schemas: {
                    Pet: {type: 'object', properties: {name: {type: 'string', nullable: true}, age: {type: 'integer', format: 'int32', exclusiveMinimum: true, minimum: 0}}, required: ['name']}
                }
            }
        }
        const pet: Schema = fromJsonSchema({$ref: '#/components/schemas/Pet'}, {dialect: 'openapi-3.0', document})
        assert.ok(accepts(pet, {name: null, age: 1}))
        assert.ok(!accepts(pet, {name: 'x', age: 0}))
        assert.ok(!accepts(pet, {name: 'x', age: 2 ** 31}))
    })

    it('reads the versions declared by $schema', (): void => {
        const draft04: Schema = fromJsonSchema({$schema: 'http://json-schema.org/draft-04/schema#', type: 'number', minimum: 0, exclusiveMinimum: true})
        assert.ok(!accepts(draft04, 0) && accepts(draft04, 0.5))
        const tuple: Schema = fromJsonSchema({$schema: 'http://json-schema.org/draft-07/schema#', items: [{type: 'string'}], additionalItems: false})
        assert.ok(accepts(tuple, ['a']) && !accepts(tuple, ['a', 'b']))
    })

    it('validates the formats', (): void => {
        const formats: Record<string, [unknown, unknown]> = {
            'date': ['2020-02-29', '2021-02-29'],
            'date-time': ['2020-01-01T00:00:00Z', '2020-01-01'],
            'email': ['a@b.io', 'a@b'],
            'uuid': ['4bf8e8a4-7a67-4c1e-b1c1-6f2f4b7c3d2e', '4bf8e8a4'],
            'ipv4': ['1.2.3.4', '1.2.3.4/24']
        }
        for (const [format, [valid, invalid]] of Object.entries(formats)) {
            const schema: Schema = fromJsonSchema({type: 'string', format})
            assert.ok(accepts(schema, valid), `${format} accepts ${valid}`)
            assert.ok(!accepts(schema, invalid), `${format} rejects ${invalid}`)
        }
        //Unknown formats are annotations
        assert.ok(accepts(fromJsonSchema({type: 'string', format: 'phone'}), 'x'))
    })

    it('applies the defaults and keeps the annotations', (): void => {
        const schema: Schema = fromJsonSchema({type: 'object', properties: {size: {type: 'integer', default: 10, description: 'The size'}}, title: 'Options'})
        assert.deepStrictEqual(DTO.validate({}, schema), {size: 10})
        assert.deepStrictEqual(toJsonSchema(schema, {preferences: {}}), {
            type: 'object',
            properties: {size: {type: 'integer', description: 'The size', default: 10}},
            additionalProperties: true,
            title: 'Options'
        })
    })

    it('round trips the numeric types and the formats', (): void => {
        const exported: JSONSchema = toJsonSchema(DTO.Object({
            small: DTO.Number().int8(),
            ratio: DTO.Number().float(),
            day: DTO.String().format('date'),
            phone: DTO.String().meta({format: 'phone'})
        }))
        const described: Record<string, unknown> = (fromJsonSchema(exported) as unknown as Base).describe() as unknown as Record<string, unknown>
        const keys: Record<string, { rules?: { name: string }[], metas?: Record<string, unknown>[] }> = described.keys as never
        assert.deepStrictEqual(keys.small.rules!.map((rule: { name: string }): string => rule.name), ['int8'])
        assert.deepStrictEqual(keys.ratio.rules!.map((rule: { name: string }): string => rule.name), ['float'])
        assert.ok(keys.day.rules!.some((rule: { name: string }): boolean => rule.name === 'format'))
        assert.deepStrictEqual(keys.phone.metas, [{format: 'phone'}])
        assert.deepStrictEqual(toJsonSchema(fromJsonSchema(exported)), exported)
    })

    it('validates unevaluated properties with the matching subschemas', (): void => {
        const schema: Schema = fromJsonSchema({
            type: 'object',
            properties: {kind: {enum: ['a', 'b']}},
            oneOf: [
                {properties: {kind: {const: 'a'}, a: {type: 'number'}}},
                {properties: {kind: {const: 'b'}, b: {type: 'string'}}}
            ],
            unevaluatedProperties: false
        })
        assert.ok(accepts(schema, {kind: 'a', a: 1}))
        assert.ok(!accepts(schema, {kind: 'a', b: 'x'}))
        assert.ok(accepts(schema, {kind: 'b', b: 'x'}))
    })
})

describe('Schema descriptions', (): void => {

    it('rebuild the schemas exactly', (): void => {
        const schema: Schema = DTO.Object({n: DTO.Number().int8().required(), e: DTO.String().email().allow(null)})
        const rebuilt: Schema = DTO.Build(JSON.parse(JSON.stringify((schema as unknown as Base).describe())))
        for (const value of [{n: 1, e: null}, {n: 300}, {n: 1, e: 'x'}, {n: '1'}]) assert.strictEqual(accepts(rebuilt, value), accepts(schema, value), JSON.stringify(value))
    })
})
