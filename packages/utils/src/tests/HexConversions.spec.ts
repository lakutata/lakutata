import {describe, it} from 'node:test'
import assert from 'node:assert'
import {hexToIEEE754, hexToSigned, hexToUnsigned, ieee754ToHex, signedToHex, unsignedToHex} from '../exports/Utils.js'

describe('Hexadecimal conversions', (): void => {

    it('reads the width without the 0x prefix', (): void => {
        assert.strictEqual(hexToSigned('0x00FF'), hexToSigned('00FF'))
        assert.strictEqual(hexToSigned('0x00FF'), 255)
        assert.strictEqual(hexToSigned('0XFF'), -1)
        assert.strictEqual(hexToSigned('8000'), -32768)
        assert.strictEqual(hexToUnsigned('0x00ff'), 255)
        assert.strictEqual(hexToUnsigned('FFFFFFFF'), 4294967295)
    })

    it('refuses an invalid character instead of reading a part', (): void => {
        for (const hex of ['', '0x', '0x1g', '1g', '-1', ' FF', 'FF ', '0x-1']) {
            assert.throws((): unknown => hexToSigned(hex), SyntaxError, hex)
            assert.throws((): unknown => hexToUnsigned(hex), SyntaxError, hex)
        }
    })

    it('refuses the values beyond Number.MAX_SAFE_INTEGER', (): void => {
        assert.strictEqual(hexToUnsigned('1FFFFFFFFFFFFF'), Number.MAX_SAFE_INTEGER)
        assert.throws((): unknown => hexToUnsigned('20000000000000'), RangeError)
        assert.strictEqual(hexToSigned('FFFFFFFFFFFFFFFF'), -1)
        assert.strictEqual(hexToSigned('001FFFFFFFFFFFFF'), Number.MAX_SAFE_INTEGER)
        assert.strictEqual(hexToSigned('FFE0000000000001'), Number.MIN_SAFE_INTEGER)
        assert.throws((): unknown => hexToSigned('0020000000000000'), RangeError)
        assert.throws((): unknown => hexToSigned('8000000000000000'), RangeError)
    })

    it('reads the IEEE 754 numbers of 4 and 8 bytes, with a 0x prefix too', (): void => {
        assert.strictEqual(hexToIEEE754('3F800000'), 1)
        assert.strictEqual(hexToIEEE754('0x3F800000'), 1)
        assert.strictEqual(hexToIEEE754('0x3FF0000000000000'), 1)
        assert.strictEqual(hexToIEEE754('400921FB54442D18'), Math.PI)
        assert.ok(Number.isNaN(hexToIEEE754('7FC00000')))
        for (const hex of ['', '3F80', '3F8000', '3F80000000', '3FF00000000000000000']) assert.throws((): unknown => hexToIEEE754(hex), RangeError, hex)
        assert.throws((): unknown => hexToIEEE754('3F80000G'), SyntaxError)
    })

    it('writes NaN as the canonical quiet NaN', (): void => {
        assert.strictEqual(ieee754ToHex(NaN), '7FC00000')
        assert.strictEqual(ieee754ToHex(NaN, 64), '7FF8000000000000')
        const buffer: Buffer = Buffer.alloc(4)
        buffer.writeFloatBE(NaN)
        assert.strictEqual(ieee754ToHex(NaN), buffer.toString('hex').toUpperCase())
        assert.strictEqual(ieee754ToHex(1), '3F800000')
        assert.strictEqual(ieee754ToHex(-0), '80000000')
    })

    it('refuses the numbers out of the width', (): void => {
        assert.strictEqual(unsignedToHex(255, 8), 'FF')
        assert.strictEqual(unsignedToHex(0, 16), '0000')
        assert.strictEqual(unsignedToHex(Number.MAX_SAFE_INTEGER, 64), '001FFFFFFFFFFFFF')
        for (const [value, bits] of [[-1, 32], [256, 8], [65536, 16], [2 ** 32, 32], [1.5, 32]] as [number, 8 | 16 | 32][]) {
            assert.throws((): unknown => unsignedToHex(value, bits), RangeError, `${value} ${bits}`)
        }
        assert.strictEqual(signedToHex(-128, 8), '80')
        assert.strictEqual(signedToHex(127, 8), '7F')
        assert.strictEqual(signedToHex(-1), 'FFFFFFFF')
        for (const [value, bits] of [[128, 8], [-129, 8], [256, 8], [-300, 8], [2 ** 31, 32], [0.5, 8]] as [number, 8 | 32][]) {
            assert.throws((): unknown => signedToHex(value, bits), RangeError, `${value} ${bits}`)
        }
        //The reverse conversions
        for (const value of [-32768, -1, 0, 1, 32767]) assert.strictEqual(hexToSigned(signedToHex(value, 16)), value)
    })
})
