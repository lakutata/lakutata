/**
 * Not from upstream: the lodash semantics joi-to-json relies on, kept by the native helpers (the expected values were
 * produced by lodash 4.17.21)
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import * as _ from '../../../lib/validation/engine/json-schema/helpers.js'

describe('joi-to-json helpers', () => {

    describe('merge()', () => {

        it('lets null replace a value (disabled logical operator parsers)', () => {
            expect(_.merge({a: {f: 1, g: 2}}, {a: {f: null}})).to.equal({a: {f: null, g: 2}})
        })

        it('does not replace a value with undefined, but adds a missing key', () => {
            const merged = _.merge({a: 1}, {a: undefined, b: undefined})
            expect(merged.a).to.equal(1)
            expect(Object.keys(merged)).to.equal(['a', 'b'])
        })

        it('merges arrays by index', () => {
            expect(_.merge({a: [1, 2, 3]}, {a: [9]})).to.equal({a: [9, 2, 3]})
        })

        it('merges an object into an existing array', () => {
            const merged = _.merge({a: [1, 2]}, {a: {x: 1}})
            expect(Array.isArray(merged.a)).to.be.true()
            expect(merged.a.x).to.equal(1)
        })

        it('replaces an object with an array', () => {
            expect(_.merge({a: {x: 1}}, {a: [5]})).to.equal({a: [5]})
        })

        it('skips falsy sources', () => {
            expect(_.merge({a: 1}, false, null, 0, {b: 2})).to.equal({a: 1, b: 2})
        })

        it('merges circular sources', () => {
            const circular = {a: 1}
            circular.self = circular
            const merged = _.merge({}, circular)
            expect(merged.self).to.not.shallow.equal(merged)
            expect(merged.self.self).to.shallow.equal(merged.self)
            expect(merged.self.a).to.equal(1)
        })
    })

    it('get() reads dotted paths, a key present as is first', () => {
        expect(_.get({a: {b: null}}, 'a.b')).to.equal(null)
        expect(_.get({a: null}, 'a.b')).to.equal(undefined)
        expect(_.get({'a.b': 1, a: {b: 2}}, 'a.b')).to.equal(1)
        expect(_.get('abc', 'length')).to.equal(3)
    })

    it('set() creates the missing objects, arrays for index segments', () => {
        expect(_.set({}, 'components.schemas', {x: 1})).to.equal({components: {schemas: {x: 1}}})
        expect(_.set({}, 'a.0.b', 1)).to.equal({a: [{b: 1}]})
        expect(_.set({a: 5}, 'a.b', 1)).to.equal({a: {b: 1}})
    })

    it('isEmpty() checks lengths, sizes and own enumerable keys', () => {
        const values = [null, 0, '', 'a', [], {}, {a: undefined}, new Map(), () => 1]
        expect(values.map((value) => _.isEmpty(value))).to.equal([true, true, true, false, true, true, false, true, true])
    })

    it('remove() removes in place and returns the removed items', () => {
        const array = [1, 2, 3, 4]
        expect(_.remove(array, (value) => value % 2)).to.equal([1, 3])
        expect(array).to.equal([2, 4])
    })

    it('pickBy(), size(), uniq() and compact()', () => {
        expect(_.pickBy({a: 1, b: 2, c: 3}, (value, key) => key !== 'b')).to.equal({a: 1, c: 3})
        expect([_.size(null), _.size('abc'), _.size({a: 1, b: 2}), _.size([1])]).to.equal([0, 3, 2, 1])
        expect(_.uniq([1, NaN, 1, NaN, '1'])).to.equal([1, NaN, '1'])
        expect(_.compact([0, 1, '', null, 'a', false, undefined, NaN])).to.equal([1, 'a'])
    })
})

describe('joi-to-json additions', () => {

    it('converts array().unique() (not covered upstream)', async () => {
        const {default: joi} = await import('../../../lib/validation/engine/schema/index.js')
        const {default: parse} = await import('../../../lib/validation/engine/json-schema/index.js')
        const schema = joi.array().items(joi.number()).unique()
        for (const mode of ['json', 'json-draft-04', 'open-api']) {
            expect(parse(schema, mode)).to.equal({type: 'array', uniqueItems: true, items: {type: 'number'}})
        }
    })
})

describe('joi-to-json fixes', () => {

    it('converts a switch with a single branch like the equivalent condition (upstream threw a ReferenceError)', async () => {
        const {default: joi} = await import('../../../lib/validation/engine/schema/index.js')
        const {default: parse} = await import('../../../lib/validation/engine/json-schema/index.js')
        const withSwitch = joi.object({t: joi.string(), v: joi.any().when('t', {switch: [{is: 'a', then: joi.string()}]})})
        const withCondition = joi.object({t: joi.string(), v: joi.any().when('t', {is: 'a', then: joi.string()})})
        const alternatives = joi.alternatives().conditional('t', {switch: [{is: 1, then: joi.number()}]})
        for (const mode of ['json', 'json-draft-04', 'json-draft-2019-09', 'open-api', 'open-api-3.1']) {
            expect(parse(withSwitch, mode)).to.equal(parse(withCondition, mode))
            expect(parse(alternatives, mode).type).to.equal('number')
        }
    })
})
