/**
 * Ported from joi/test/modify.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
import * as Helper from './Helper.js'
const internals = {}

describe('Modify', () => {

    describe('extract()', () => {

        it('extracts nested schema with keys', () => {

            const d = Engine.number()
            const c = Engine.object({ d })
            const b = Engine.object({ c })
            const a = Engine.object({ b })

            expect(a.extract('b')).to.shallow.equal(b)
            expect(a.extract('b.c.d')).to.shallow.equal(d)
            expect(a.extract(['b', 'c', 'd'])).to.shallow.equal(d)
        })

        it('extracts nested schema with ids', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('B')
            const a = Engine.object({ b })

            expect(a.extract('B')).to.shallow.equal(b)
            expect(a.extract('B.C.D')).to.shallow.equal(d)
        })

        it('extracts nested schema with ids by keys', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('B')
            const a = Engine.object({ b })

            expect(a.extract('b')).to.shallow.equal(b)
            expect(a.extract('b.c.d')).to.shallow.equal(d)
        })

        it('extracts nested schema with duplicate ids', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('B')
            const a = Engine.object({ b, x: b })

            expect(a.extract('b')).to.shallow.equal(b)
            expect(a.extract('x')).to.shallow.equal(b)
            expect(a.extract('b.c.d')).to.shallow.equal(d)
        })

        it('extracts nested schema from array', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('b')
            const a = Engine.array().items(b)

            expect(a.extract('b')).to.shallow.equal(b)
            expect(a.extract('b.c.d')).to.shallow.equal(d)
        })

        it('extracts nested schema from alternatives', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('b')
            const a = Engine.alternatives(b)

            expect(a.extract('b')).to.shallow.equal(b)
            expect(a.extract('b.c.d')).to.shallow.equal(d)
        })

        it('extracts nested schema after object key override', () => {

            const d = Engine.number()
            const c = Engine.object({ d })
            const b = Engine.object({ c })
            const a = Engine.object({ b })
            const x = a.keys({ b: c })

            expect(x.extract('b')).to.shallow.equal(c)
            expect(x.extract('b.d')).to.shallow.equal(d)
        })

        it('extracts nested schema after object key override and custom ids', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('B')
            const a = Engine.object({ b }).id('A')
            const x = a.keys({ b: c })

            expect(x.extract('C')).to.shallow.equal(c)
            expect(x.extract('C.D')).to.shallow.equal(d)
        })

        it('extracts nested schema after object concat (keys)', () => {

            const d = Engine.number()
            const c = Engine.object({ d })
            const b = Engine.object({ c })
            const a = Engine.object({ b })
            const x = a.concat(b)

            expect(x.extract('b')).to.shallow.equal(b)
            expect(x.extract('c')).to.shallow.equal(c)
        })

        it('extracts nested schema after object concat (ids)', () => {

            const d = Engine.number().id('D')
            const c = Engine.object({ d }).id('C')
            const b = Engine.object({ c }).id('B')
            const a = Engine.object({ b }).id('A')
            const x = a.concat(b)

            expect(x.extract('B')).to.shallow.equal(b)
            expect(x.extract('C')).to.shallow.equal(c)
        })

        it('errors on missing schema', () => {

            const d = Engine.number()
            const c = Engine.object({ d })
            const b = Engine.object({ c })
            const a = Engine.object({ b })

            expect(() => a.extract(['b', 'c', 'x'])).to.throw('Schema does not contain path b.c.x')
        })

        it('errors on conflicting schema ids', () => {

            const a = Engine.number().id('A')
            const b = Engine.string().id('A')

            expect(() => Engine.object({ a, b })).to.throw('Cannot add different schemas with the same id: A')
        })
    })

    describe('fork()', () => {

        it('adjusts empty', () => {

            const before = Engine.string().empty(Engine.number().id('x'))
            const after = Engine.string().empty(Engine.number().min(10).id('x'))

            Helper.equal(before.fork('x', (schema) => schema.min(10)), after)
        })

        it('preserves unchanged schemas', () => {

            const before = Engine.object({ x: Engine.string().optional() })
            const after = Engine.object({ x: Engine.string().optional() })

            Helper.equal(before.fork('x', (schema) => schema.optional()), after)
        })

        it('adjusts reused schema in multiple places', () => {

            const shared = Engine.number().id('x')

            const before = Engine.object({
                a: shared,
                b: shared
            })

            expect(before.extract('a')).to.shallow.equal(before.extract('b'))

            const sharedAfter = shared.min(10)
            const after = Engine.object({
                a: sharedAfter,
                b: sharedAfter
            })

            expect(after.extract('a')).to.shallow.equal(after.extract('b'))

            const modified = before.fork('x', (schema) => schema.min(10))
            Helper.equal(modified, after)
            expect(modified.extract('a')).to.shallow.equal(modified.extract('b'))
        })

        describe('alternatives', () => {

            it('adjusts nested schema', () => {

                const before = Engine.alternatives([
                    Engine.number().positive().id('numbers'),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive()
                        })
                    }).id('objects')
                ])

                const first = before.fork('objects.c.d', (schema) => schema.max(5))

                const after1 = Engine.alternatives([
                    Engine.number().positive().id('numbers'),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive().max(5)
                        })
                    }).id('objects')
                ])

                Helper.equal(first, after1)

                const second = first.fork('numbers', (schema) => schema.min(10))

                const after2 = Engine.alternatives([
                    Engine.number().positive().id('numbers').min(10),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive().max(5)
                        })
                    }).id('objects')
                ])

                Helper.equal(second, after2)
            })

            it('adjusts when schema', () => {

                const before = Engine.object({
                    a: Engine.number(),
                    b: Engine.boolean()
                        .when('a', [
                            { is: 0, then: Engine.valid(0).id('zero') },
                            { is: 1, then: Engine.valid(1).id('one') }
                        ])
                })

                const forked = before.fork('b.one', (schema) => schema.allow(2))

                const after = Engine.object({
                    a: Engine.number(),
                    b: Engine.boolean()
                        .when('a', [
                            { is: 0, then: Engine.valid(0).id('zero') },
                            { is: 1, then: Engine.valid(1, 2).id('one') }
                        ])
                })

                Helper.equal(forked, after)
            })

            it('adjusts alternatives schema', () => {

                const before = Engine.object({
                    a: Engine.number(),
                    b: Engine.alternatives()
                        .conditional('a', {
                            switch: [
                                { is: 0, then: Engine.valid(0).id('zero') },
                                { is: 1, then: Engine.valid(1).id('one'), otherwise: Engine.boolean() }
                            ]
                        })
                })

                const forked = before.fork('b.one', (schema) => schema.allow(2))

                const after = Engine.object({
                    a: Engine.number(),
                    b: Engine.alternatives()
                        .conditional('a', {
                            switch: [
                                { is: 0, then: Engine.valid(0).id('zero') },
                                { is: 1, then: Engine.valid(1, 2).id('one'), otherwise: Engine.boolean() }
                            ]
                        })
                })

                Helper.equal(forked, after)
            })
        })

        describe('array', () => {

            it('adjusts nested schema', () => {

                const before = Engine.array().items(
                    Engine.number().positive().id('numbers'),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive()
                        })
                    })
                        .id('objects')
                )
                    .has(Engine.object())
                    .has(Engine.valid(5).id('five'))

                const first = before.fork('objects.c.d', (schema) => schema.max(5))

                const after1 = Engine.array().items(
                    Engine.number().positive().id('numbers'),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive().max(5)
                        })
                    })
                        .id('objects')
                )
                    .has(Engine.object())
                    .has(Engine.valid(5).id('five'))

                Helper.equal(first, after1)

                const second = first.fork('numbers', (schema) => schema.min(10))

                const after2 = Engine.array().items(
                    Engine.number().positive().id('numbers').min(10),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive().max(5)
                        })
                    })
                        .id('objects')
                )
                    .has(Engine.object())
                    .has(Engine.valid(5).id('five'))

                Helper.equal(second, after2)

                const third = second.fork('five', (schema) => schema.allow(-5))

                const after3 = Engine.array().items(
                    Engine.number().positive().id('numbers').min(10),
                    Engine.object({
                        c: Engine.object({
                            d: Engine.number().positive().max(5)
                        })
                    })
                        .id('objects')
                )
                    .has(Engine.object())
                    .has(Engine.valid(5, -5).id('five'))

                Helper.equal(third, after3)
            })
        })

        describe('object', () => {

            it('adjusts nested schema', () => {

                const before = Engine.object({
                    a: Engine.number(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number()
                        })
                    })
                })

                const after = Engine.object({
                    a: Engine.number(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().min(10)
                        })
                    })
                })

                Helper.equal(before.fork('b.c.d', (schema) => schema.min(10)), after)
                Helper.equal(before.fork([['b', 'c', 'd']], (schema) => schema.min(10)), after)
            })

            it('forks multiple times', () => {

                const before = Engine.object({
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number()
                        })
                    }),
                    x: Engine.number()
                })

                const bd = before.describe()

                const first = before.fork('b.c.d', (schema) => schema.min(10))
                const fd = first.describe()

                const second = first.fork('b.c.d', (schema) => schema.max(20))
                const sd = second.describe()

                const third = second.fork('b.c.d', (schema) => schema.min(5))
                const td = third.describe()

                const fourth = third.fork('x', (schema) => schema.required())

                const after = Engine.object({
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().max(20).min(5)
                        })
                    }),
                    x: Engine.number().required()
                })

                Helper.equal(fourth, after)

                expect(before.describe()).to.equal(bd)
                expect(first.describe()).to.equal(fd)
                expect(second.describe()).to.equal(sd)
                expect(third.describe()).to.equal(td)
            })

            it('forks same schema multiple times', () => {

                const before = Engine.object({
                    x: Engine.number(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number()
                        })
                    })
                })

                const bd = before.describe()

                const first = before.fork('b.c.d', (schema) => schema.min(10))
                const fd = first.describe()

                const second = before.fork('b.c.d', (schema) => schema.max(20))
                const sd = second.describe()

                const third = before.fork('b.c.d', (schema) => schema.min(5))
                const td = third.describe()

                const fourth = before.fork('x', (schema) => schema.required())

                const a1 = Engine.object({
                    x: Engine.number(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().min(10)
                        })
                    })
                })

                Helper.equal(first, a1)

                const a2 = Engine.object({
                    x: Engine.number(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().max(20)
                        })
                    })
                })

                Helper.equal(second, a2)

                const a3 = Engine.object({
                    x: Engine.number(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().min(5)
                        })
                    })
                })

                Helper.equal(third, a3)

                const a4 = Engine.object({
                    x: Engine.number().required(),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number()
                        })
                    })
                })

                Helper.equal(fourth, a4)

                expect(before.describe()).to.equal(bd)
                expect(first.describe()).to.equal(fd)
                expect(second.describe()).to.equal(sd)
                expect(third.describe()).to.equal(td)
            })

            it('adjusts nested schema with ids', () => {

                const before = Engine.object({
                    a: Engine.number().id('A'),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().id('D')
                        })
                    })
                })

                const after = Engine.object({
                    a: Engine.number().id('A'),
                    b: Engine.object({
                        c: Engine.object({
                            d: Engine.number().id('D').min(10)
                        })
                    })
                })

                Helper.equal(before.fork('b.c.D', (schema) => schema.min(10)), after)
                Helper.equal(before.fork([['b', 'c', 'D']], (schema) => schema.min(10)), after)
            })

            it('sets keys as required', () => {

                const orig = Engine.object({ a: 0, b: 0, c: { d: 0, e: { f: 0 } }, g: { h: 0 } })
                const schema = orig.fork(['a', 'b', 'c.d', 'c.e.f', 'g'], (x) => x.required())

                Helper.validate(orig, [
                    [{}, true]
                ])

                Helper.validate(schema, [
                    [{}, false, {
                        message: '"a" is required',
                        path: ['a'],
                        type: 'any.required',
                        context: { label: 'a', key: 'a' }
                    }],
                    [{ a: 0 }, false, {
                        message: '"b" is required',
                        path: ['b'],
                        type: 'any.required',
                        context: { label: 'b', key: 'b' }
                    }],
                    [{ a: 0, b: 0 }, false, {
                        message: '"g" is required',
                        path: ['g'],
                        type: 'any.required',
                        context: { label: 'g', key: 'g' }
                    }],
                    [{ a: 0, b: 0, g: {} }, true],
                    [{ a: 0, b: 0, c: {}, g: {} }, false, {
                        message: '"c.d" is required',
                        path: ['c', 'd'],
                        type: 'any.required',
                        context: { label: 'c.d', key: 'd' }
                    }],
                    [{ a: 0, b: 0, c: { d: 0 }, g: {} }, true],
                    [{ a: 0, b: 0, c: { d: 0, e: {} }, g: {} }, false, {
                        message: '"c.e.f" is required',
                        path: ['c', 'e', 'f'],
                        type: 'any.required',
                        context: { label: 'c.e.f', key: 'f' }
                    }],
                    [{ a: 0, b: 0, c: { d: 0, e: { f: 0 } }, g: {} }, true]
                ])
            })

            it('sets keys as optional', () => {

                const schema = Engine.object({
                    a: Engine.number().required(),
                    b: Engine.number().required()
                }).
                    fork(['a', 'b'], (x) => x.optional())

                Helper.validate(schema, [
                    [{}, true],
                    [{ a: 0 }, true],
                    [{ a: 0, b: 0 }, true]
                ])
            })

            it('sets keys as forbidden', () => {

                const schema = Engine.object({
                    a: Engine.number().required(),
                    b: Engine.number().required()
                }).
                    fork(['a', 'b'], (x) => x.forbidden())

                Helper.validate(schema, [
                    [{}, true],
                    [{ a: undefined }, true],
                    [{ a: undefined, b: undefined }, true],
                    [{ a: 0 }, false, {
                        message: '"a" is not allowed',
                        path: ['a'],
                        type: 'any.unknown',
                        context: { label: 'a', key: 'a', value: 0 }
                    }],
                    [{ b: 0 }, false, {
                        message: '"b" is not allowed',
                        path: ['b'],
                        type: 'any.unknown',
                        context: { label: 'b', key: 'b', value: 0 }
                    }]
                ])
            })

            it('adjusts object assert', () => {

                const before = Engine.object({
                    a: Engine.object({
                        b: Engine.number()
                    }),
                    b: Engine.object({
                        d: Engine.number()
                    })
                })
                    .assert('b.d', Engine.valid(1))
                    .assert('a.b', Engine.valid(Engine.ref('b.d')).id('assert'))

                const after = Engine.object({
                    a: Engine.object({
                        b: Engine.number()
                    }),
                    b: Engine.object({
                        d: Engine.number()
                    })
                })
                    .assert('b.d', Engine.valid(1))
                    .assert('a.b', Engine.valid(Engine.ref('b.d'), 'x').id('assert'))

                expect(before.fork('assert', (schema) => schema.valid('x')).describe()).to.equal(after.describe())
            })

            it('adjusts object assert (with pattern)', () => {

                const before = Engine.object({
                    a: Engine.object({
                        b: Engine.number()
                    }),
                    b: Engine.object({
                        d: Engine.number()
                    })
                })
                    .min(2)
                    .pattern(/\d/, Engine.any())
                    .assert('a.b', Engine.valid(Engine.ref('b.d')).id('assert'))

                const after = Engine.object({
                    a: Engine.object({
                        b: Engine.number()
                    }),
                    b: Engine.object({
                        d: Engine.number()
                    })
                })
                    .min(2)
                    .pattern(/\d/, Engine.any())
                    .assert('a.b', Engine.valid(Engine.ref('b.d'), 'x').id('assert'))

                expect(before.fork('assert', (schema) => schema.valid('x')).describe()).to.equal(after.describe())
            })

            it('adjusts object pattern', () => {

                const before = Engine.object()
                    .pattern(/.*/, Engine.valid('x').id('pattern'))

                const after = Engine.object()
                    .pattern(/.*/, Engine.valid('x', 'y').id('pattern'))

                expect(before.fork('pattern', (schema) => schema.valid('y')).describe()).to.equal(after.describe())
            })
        })
    })

    describe('id()', () => {

        it('unsets id', () => {

            const schema = Engine.any().id('x')
            Helper.equal(schema.id(), Engine.any())
        })

        it('errors on invalid id', () => {

            expect(() => Engine.any().id('a.b')).to.throw('id cannot contain period character')
        })

        it('overrides id', () => {

            const schema = Engine.any().id('x')
            Helper.equal(schema.id('y'), Engine.any().id('y'))
        })
    })

    describe('labels()', () => {

        it('extracts nested schema', () => {

            const d = Engine.number()
            const c = Engine.object({ d })
            const b = Engine.object({ c })
            const a = Engine.object({ b })

            expect(a.$_mapLabels('b')).to.equal('b')
            expect(a.$_mapLabels('b.c.d')).to.equal('b.c.d')
            expect(a.$_mapLabels(['b', 'c', 'd'])).to.equal('b.c.d')
        })

        it('extracts nested schema with ids', () => {

            const d = Engine.number().label('D')
            const c = Engine.object({ d }).label('C')
            const b = Engine.object({ c }).label('B')
            const a = Engine.object({ b })

            expect(a.$_mapLabels('b')).to.equal('B')
            expect(a.$_mapLabels('b.c.d')).to.equal('B.C.D')
        })
    })

    describe('schema()', () => {

        it('changes multiple schemas in different sources', () => {

            const custom = Engine.extend({
                type: 'special',
                coerce(value, helpers) {

                    const swap = helpers.schema.$_getFlag('swap')
                    if (swap &&
                        swap.$_match(value, helpers.state.nest(swap), helpers.prefs)) {

                        return { value: ['swapped'] }
                    }
                },
                terms: {
                    x: { init: [] }
                },
                rules: {
                    swap: {
                        method(schema) {

                            return this.$_setFlag('swap', this.$_compile(schema))
                        }
                    },
                    pattern: {
                        method(schema) {

                            return this.$_addRule({ name: 'pattern', args: { schema: this.$_compile(schema) } })
                        },
                        validate() { }
                    },
                    term: {
                        method(schema) {

                            this.$_terms.x.push(schema)
                            return this
                        }
                    }
                }
            })

            const schema = custom.special()
                .swap(Engine.number())
                .empty(Engine.object())
                .pattern(Engine.binary())
                .term(Engine.number())

            const each = (item) => item.min(10)

            expect(schema.$_modify({ each, ref: false, schema: false })).to.equal(schema)

            const modified = schema.$_modify({ each, ref: false })

            expect(modified.describe()).to.equal({
                type: 'special',
                flags: {
                    empty: {
                        rules: [{ args: { limit: 10 }, name: 'min' }],
                        type: 'object'
                    },
                    swap: {
                        rules: [{ args: { limit: 10 }, name: 'min' }],
                        type: 'number'
                    }
                },
                rules: [{
                    args: {
                        schema: {
                            rules: [{ args: { limit: 10 }, name: 'min' }],
                            type: 'binary'
                        }
                    },
                    name: 'pattern'
                }],
                x: [
                    {
                        rules: [{ args: { limit: 10 }, name: 'min' }],
                        type: 'number'
                    }
                ]
            })
        })
    })
})
