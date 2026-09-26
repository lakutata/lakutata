import {describe, it} from 'node:test'
import assert from 'node:assert'
import Engine from '../../lib/validation/engine/schema/index.js'
import type {Base} from '../../lib/validation/engine/schema/base.js'
import type {SchemaValidationException} from '../../lib/validation/exceptions/SchemaValidationException.js'

/**
 * The error type of a validation (undefined when valid)
 * @param schema
 * @param value
 */
function errorType(schema: Base, value: unknown): string | undefined {
    return (schema.validate(value).error as SchemaValidationException | undefined)?.details[0].type
}

/**
 * The schema rebuilt from its description
 * @param schema
 */
function rebuilt(schema: Base): Base {
    return Engine.build(schema.describe()) as Base
}

describe('Schema additions', (): void => {

    it('validate the unknown keys with a schema', (): void => {
        const schema: Base = Engine.object({a: Engine.string()}).unknown(Engine.number())
        for (const s of [schema, rebuilt(schema)]) {
            assert.deepStrictEqual(s.validate({a: 'x', b: 1, c: '2'}, {convert: true}).value, {a: 'x', b: 1, c: 2})
            assert.strictEqual(errorType(s, {a: 'x', b: 'y'}), 'number.base')
        }
        //Without keys, every key is unknown
        assert.strictEqual(errorType(Engine.object().unknown(Engine.number()), {b: 'y'}), 'number.base')
        //The pattern keys are not unknown
        const patterned: Base = Engine.object().pattern(/^x/, Engine.string()).unknown(Engine.number())
        assert.strictEqual(errorType(patterned, {xa: 's', b: 1}), undefined)
        assert.strictEqual(errorType(patterned, {xa: 1}), 'string.base')
        //Not stripped
        assert.deepStrictEqual(schema.validate({b: 1}, {stripUnknown: true}).value, {b: 1})
        //A boolean keeps its meaning
        assert.strictEqual(errorType(Engine.object({}).unknown(false), {b: 1}), 'object.unknown')
        assert.strictEqual(errorType(Engine.object({}).unknown(), {b: 1}), undefined)
    })

    it('validate the key names', (): void => {
        const schema: Base = Engine.object({A: Engine.any()}).unknown().keyNames(Engine.string().pattern(/^[a-z]+$/))
        for (const s of [schema, rebuilt(schema)]) {
            assert.strictEqual(errorType(s, {ab: 1}), undefined)
            assert.strictEqual(errorType(s, {a1: 1}), 'object.keyNames')
            //Defined keys too
            assert.strictEqual(errorType(s, {A: 1}), 'object.keyNames')
        }
        assert.strictEqual(schema.validate({a1: 1}).error?.message, '"value" has a key name "a1" which is not allowed')
    })

    it('count the matching items', (): void => {
        const schema: Base = Engine.array().has(Engine.number(), {min: 2, max: 3})
        for (const s of [schema, rebuilt(schema)]) {
            assert.strictEqual(errorType(s, [1, 'a']), 'array.hasMin')
            assert.strictEqual(errorType(s, [1, 'a', 2]), undefined)
            assert.strictEqual(errorType(s, [1, 2, 3, 4]), 'array.hasMax')
        }
        assert.strictEqual(errorType(Engine.array().has(Engine.number(), {min: 0}), []), undefined)
        assert.strictEqual(errorType(Engine.array().has(Engine.number(), {max: 1}), []), 'array.hasMin')
        //Without options, the description is unchanged
        assert.deepStrictEqual(Engine.array().has(Engine.number()).describe(), {type: 'array', rules: [{name: 'has', args: {schema: {type: 'number'}}}]})
        assert.throws((): unknown => Engine.array().has(Engine.number(), {min: -1}))
    })

    it('match none of the alternatives', (): void => {
        const schema: Base = Engine.alternatives().try(Engine.string(), Engine.number()).match('none')
        for (const s of [schema, rebuilt(schema)]) {
            assert.strictEqual(errorType(s, true), undefined)
            assert.strictEqual(errorType(s, 'x'), 'alternatives.none')
            assert.strictEqual(errorType(s, 1), 'alternatives.none')
        }
        assert.strictEqual(schema.validate(true).value, true)
    })
})
