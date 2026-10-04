import {describe, it} from 'node:test'
import assert from 'node:assert'
import {HexToIEEE754, HexToSigned, HexToUnsigned, IEEE754ToHex, SignedToHex, UnsignedToHex} from '../exports/Utils.js'

describe('Hexadecimal conversions', (): void => {

    it('reads the width without the 0x prefix', (): void => {
        assert.strictEqual(HexToSigned('0x00FF'), HexToSigned('00FF'))
        assert.strictEqual(HexToSigned('0x00FF'), 255)
        assert.strictEqual(HexToSigned('0XFF'), -1)
        assert.strictEqual(HexToSigned('8000'), -32768)
        assert.strictEqual(HexToUnsigned('0x00ff'), 255)
        assert.strictEqual(HexToUnsigned('FFFFFFFF'), 4294967295)
    })

    it('refuses an invalid character instead of reading a part', (): void => {
        for (const hex of ['', '0x', '0x1g', '1g', '-1', ' FF', 'FF ', '0x-1']) {
            assert.throws((): unknown => HexToSigned(hex), SyntaxError, hex)
            assert.throws((): unknown => HexToUnsigned(hex), SyntaxError, hex)
        }
    })

    it('refuses the values beyond Number.MAX_SAFE_INTEGER', (): void => {
        assert.strictEqual(HexToUnsigned('1FFFFFFFFFFFFF'), Number.MAX_SAFE_INTEGER)
        assert.throws((): unknown => HexToUnsigned('20000000000000'), RangeError)
        assert.strictEqual(HexToSigned('FFFFFFFFFFFFFFFF'), -1)
        assert.strictEqual(HexToSigned('001FFFFFFFFFFFFF'), Number.MAX_SAFE_INTEGER)
        assert.strictEqual(HexToSigned('FFE0000000000001'), Number.MIN_SAFE_INTEGER)
        assert.throws((): unknown => HexToSigned('0020000000000000'), RangeError)
        assert.throws((): unknown => HexToSigned('8000000000000000'), RangeError)
    })

    it('reads the IEEE 754 numbers of 4 and 8 bytes, with a 0x prefix too', (): void => {
        assert.strictEqual(HexToIEEE754('3F800000'), 1)
        assert.strictEqual(HexToIEEE754('0x3F800000'), 1)
        assert.strictEqual(HexToIEEE754('0x3FF0000000000000'), 1)
        assert.strictEqual(HexToIEEE754('400921FB54442D18'), Math.PI)
        assert.ok(Number.isNaN(HexToIEEE754('7FC00000')))
        for (const hex of ['', '3F80', '3F8000', '3F80000000', '3FF00000000000000000']) assert.throws((): unknown => HexToIEEE754(hex), RangeError, hex)
        assert.throws((): unknown => HexToIEEE754('3F80000G'), SyntaxError)
    })

    it('writes NaN as the canonical quiet NaN', (): void => {
        assert.strictEqual(IEEE754ToHex(NaN), '7FC00000')
        assert.strictEqual(IEEE754ToHex(NaN, 64), '7FF8000000000000')
        const buffer: Buffer = Buffer.alloc(4)
        buffer.writeFloatBE(NaN)
        assert.strictEqual(IEEE754ToHex(NaN), buffer.toString('hex').toUpperCase())
        assert.strictEqual(IEEE754ToHex(1), '3F800000')
        assert.strictEqual(IEEE754ToHex(-0), '80000000')
    })

    it('refuses the numbers out of the width', (): void => {
        assert.strictEqual(UnsignedToHex(255, 8), 'FF')
        assert.strictEqual(UnsignedToHex(0, 16), '0000')
        assert.strictEqual(UnsignedToHex(Number.MAX_SAFE_INTEGER, 64), '001FFFFFFFFFFFFF')
        for (const [value, bits] of [[-1, 32], [256, 8], [65536, 16], [2 ** 32, 32], [1.5, 32]] as [number, 8 | 16 | 32][]) {
            assert.throws((): unknown => UnsignedToHex(value, bits), RangeError, `${value} ${bits}`)
        }
        assert.strictEqual(SignedToHex(-128, 8), '80')
        assert.strictEqual(SignedToHex(127, 8), '7F')
        assert.strictEqual(SignedToHex(-1), 'FFFFFFFF')
        for (const [value, bits] of [[128, 8], [-129, 8], [256, 8], [-300, 8], [2 ** 31, 32], [0.5, 8]] as [number, 8 | 32][]) {
            assert.throws((): unknown => SignedToHex(value, bits), RangeError, `${value} ${bits}`)
        }
        //The reverse conversions
        for (const value of [-32768, -1, 0, 1, 32767]) assert.strictEqual(HexToSigned(SignedToHex(value, 16)), value)
    })
})
