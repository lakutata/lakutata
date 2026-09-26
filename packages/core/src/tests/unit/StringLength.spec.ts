import {describe, it} from 'node:test'
import assert from 'node:assert'
import Engine from '../../lib/validation/engine/schema/index.js'
import {codePointLength} from '../../lib/validation/engine/schema/types/string.js'

describe('String length', (): void => {

    it('counts Unicode code points', (): void => {
        assert.strictEqual(codePointLength(''), 0)
        assert.strictEqual(codePointLength('abc'), 3)
        assert.strictEqual(codePointLength('😀'), 1)
        assert.strictEqual(codePointLength('a😀b'), 3)
        //Lone surrogates count as one character each
        assert.strictEqual(codePointLength('\uD83Da'), 2)
        assert.strictEqual(codePointLength('a\uDE00'), 2)
        assert.strictEqual(codePointLength('\uDE00\uD83D'), 2)
    })

    it('limits the length in code points', (): void => {
        assert.strictEqual(Engine.string().max(2).validate('😀😀').error, undefined)
        assert.ok(Engine.string().max(1).validate('😀😀').error)
        assert.strictEqual(Engine.string().length(1).validate('😀').error, undefined)
        assert.ok(Engine.string().min(3).validate('😀😀').error)
        //An encoding limits the length in bytes
        assert.ok(Engine.string().max(2, 'utf8').validate('😀').error)
    })

    it('truncates without splitting surrogate pairs', (): void => {
        assert.strictEqual(Engine.string().max(2).truncate().validate('😀😀😀').value, '😀😀')
        assert.strictEqual(Engine.string().max(2).truncate().validate('a😀b').value, 'a😀')
        assert.strictEqual(Engine.string().max(5).truncate().validate('abc').value, 'abc')
    })
})
