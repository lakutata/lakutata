/**
 * Ported from combinations 1.0.0 test/combo.test.js (MIT, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept (only the runner and the code style differ). Not type-checked.
 */
// @ts-nocheck
import assert from 'node:assert'
import {describe, it} from 'node:test'
import {combinations as combo} from '../../../lib/validation/engine/json-schema/combinations.js'

describe('combo', function () {

    it('1 item array', function () {

        var out = combo(['a'])

        assert.deepEqual(out, [['a']])

    })

    it('2 item array', function () {

        var out = combo(['a', 'b'])

        assert.deepEqual(out, [['a'], ['b'], ['a', 'b']])

    })

    it('3 item array', function () {
        var out = combo(['a', 'b', 'c'])

        assert.deepEqual(out, [['a'], ['b'], ['c'], ['a', 'b'], ['a', 'c'], ['b', 'c'], ['a', 'b', 'c']])
    })

    it('4 item array with min 2 and max 3 elements', function () {
        var out = combo(['a', 'b', 'c', 'd'], 2, 3)

        assert.deepEqual(out, [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd'], ['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'c', 'd'], ['b', 'c', 'd']])
    })

})
