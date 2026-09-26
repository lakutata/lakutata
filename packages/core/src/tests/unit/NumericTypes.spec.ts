import {describe, it} from 'node:test'
import assert from 'node:assert'
import {VLD} from '../../lib/validation/VLD.js'
import type {NumberSchema} from '../../lib/validation/interfaces/NumberSchema.js'
import type {Base} from '../../lib/validation/engine/schema/base.js'
import type {SchemaValidationException} from '../../lib/validation/exceptions/SchemaValidationException.js'

type NumericType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64'

/**
 * The error type of a validation (undefined when valid)
 * @param schema
 * @param value
 */
function errorType(schema: NumberSchema, value: unknown): string | undefined {
    return ((schema as unknown as Base).validate(value).error as SchemaValidationException | undefined)?.details[0].type
}

describe('Numeric types', (): void => {

    it('limit the integer types to their ranges', (): void => {
        const ranges: [NumericType, number, number][] = [
            ['int8', -128, 127],
            ['uint8', 0, 255],
            ['int16', -32768, 32767],
            ['uint16', 0, 65535],
            ['int32', -2147483648, 2147483647],
            ['uint32', 0, 4294967295],
            ['int64', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
            ['uint64', 0, Number.MAX_SAFE_INTEGER]
        ]
        for (const [type, min, max] of ranges) {
            const schema: NumberSchema = VLD.number()[type]()
            assert.strictEqual(errorType(schema, min), undefined, `${type} accepts ${min}`)
            assert.strictEqual(errorType(schema, max), undefined, `${type} accepts ${max}`)
            if (type.endsWith('64')) continue
            assert.strictEqual(errorType(schema, min - 1), `number.${type}`, `${type} rejects ${min - 1}`)
            assert.strictEqual(errorType(schema, max + 1), `number.${type}`, `${type} rejects ${max + 1}`)
            assert.strictEqual(errorType(schema, 1.5), 'number.integer', `${type} rejects 1.5`)
        }
        assert.strictEqual(errorType(VLD.number().int64(), 2 ** 60), 'number.unsafe')
        assert.strictEqual(errorType(VLD.number().uint64(), -1), 'number.uint64')
    })

    it('limit float to the 32-bit floating point range', (): void => {
        assert.strictEqual(errorType(VLD.number().float(), 0.1), undefined)
        assert.strictEqual(errorType(VLD.number().float(), -3.4028234663852886e38), undefined)
        assert.strictEqual(errorType(VLD.number().float(), 3.5e38), 'number.float')
        assert.strictEqual(errorType(VLD.number().float(), 1e20), undefined)
    })

    it('accept every finite number as double', (): void => {
        assert.strictEqual(errorType(VLD.number().double(), 1e300), undefined)
        assert.strictEqual(errorType(VLD.number().double(), -Number.MAX_VALUE), undefined)
        assert.strictEqual(errorType(VLD.number().double(), Infinity), 'number.infinity')
    })

    it('convert strings like other number rules', (): void => {
        assert.strictEqual((VLD.number().uint8() as unknown as Base).validate('12').value, 12)
        assert.strictEqual(errorType(VLD.number().uint8(), '300'), 'number.uint8')
    })

    it('are described as rules', (): void => {
        assert.deepStrictEqual(VLD.number().int32().describe(), {type: 'number', rules: [{name: 'int32'}]})
        assert.deepStrictEqual(VLD.number().float().describe(), {type: 'number', flags: {unsafe: true}, rules: [{name: 'float'}]})
    })
})
