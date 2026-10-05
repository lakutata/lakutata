import {describe, it} from 'node:test'
import assert from 'node:assert'
import {nonceString, randomString} from '../exports/Utils.js'

describe('randomString', (): void => {

    it('generates strings of the named and custom character sets', (): void => {
        assert.match(randomString(), /^[A-Za-z0-9]{32}$/)
        assert.match(randomString(16, 'hex'), /^[0-9a-f]{16}$/)
        assert.match(randomString(10, ['numeric', 'XYZ']), /^[0-9XYZ]{10}$/)
        assert.match(nonceString(), /^[A-Za-z0-9]{32}$/)
        assert.strictEqual(randomString(0), '')
        assert.strictEqual(randomString(20000, 'binary').length, 20000)
    })

    it('refuses an empty character set, and a negative or fractional length', (): void => {
        assert.throws((): unknown => randomString(5, ''), RangeError)
        assert.throws((): unknown => randomString(5, []), RangeError)
        assert.throws((): unknown => randomString(5, ['', '']), RangeError)
        assert.throws((): unknown => randomString(-1), RangeError)
        assert.throws((): unknown => randomString(2.5), RangeError)
        assert.throws((): unknown => randomString(NaN), RangeError)
    })

    it('reads a set named like a property of Object.prototype as its characters', (): void => {
        assert.match(randomString(50, 'toString'), /^[toSring]{50}$/)
        assert.match(randomString(50, ['constructor', 'numeric']), /^[constructor0-9]{50}$/)
        assert.ok(!randomString(50, '__proto__').includes('undefined'))
    })

    it('picks whole code points', (): void => {
        const value: string = randomString(100, '😀🚀a')
        assert.strictEqual([...value].length, 100)
        assert.ok([...value].every((char: string): boolean => ['😀', '🚀', 'a'].includes(char)), value)
    })

    it('picks the characters uniformly', (): void => {
        //62 characters: a byte modulo 62 favours the first 8 by 5/4
        const counts: Map<string, number> = new Map()
        for (const char of randomString(620000)) counts.set(char, (counts.get(char) ?? 0) + 1)
        assert.strictEqual(counts.size, 62)
        for (const [char, count] of counts) assert.ok(count > 9000 && count < 11000, `${char}: ${count}`)
        //3 characters out of 2^32 values
        const ternary: Map<string, number> = new Map()
        for (const char of randomString(30000, 'abc')) ternary.set(char, (ternary.get(char) ?? 0) + 1)
        for (const [char, count] of ternary) assert.ok(count > 9400 && count < 10600, `${char}: ${count}`)
    })
})
