/**
 * Ported from the upstream test/base.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
import * as Helper from './Helper.js'
const internals = {}

describe('any', () => {

    it('should throw an exception if arguments were passed.', () => {

        expect(() => Engine.any('invalid argument.')).to.throw('The any type does not allow arguments')
    })

    describe('allow()', () => {

        it('allows valid values to be set', () => {

            const schema = Engine.any().allow(true, 1, 'hello', new Date())
            Helper.validate(schema, [
                [true, true],
                [1, true],
                ['hello', true],
                [new Date(), true]
            ])
        })

        it('overrides previous values', () => {

            const schema = Engine.object().allow(1).allow(Engine.override, 2)
            Helper.validate(schema, [
                [1, false, '"value" must be of type object'],
                [2, true]
            ])
        })

        it('clears previous values', () => {

            const schema = Engine.object().allow(1).allow(Engine.override)
            Helper.validate(schema, [
                [1, false, '"value" must be of type object'],
                [2, false, '"value" must be of type object'],
                [{}, true]
            ])
        })

        it('ignores empty override', () => {

            const schema = Engine.allow(Engine.override)
            expect(schema._valids).to.be.null()
        })

        it('throws when passed undefined', () => {

            expect(() => Engine.any().allow(undefined)).to.throw('Cannot call allow/valid/invalid with undefined')
        })

        it('throws when override is not first item', () => {

            expect(() => Engine.any().allow(1, Engine.override)).to.throw('Override must be the first value')
        })
    })

    describe('alter()', () => {

        it('errors on invalid argument', () => {

            expect(() => Engine.number().alter()).to.throw('Invalid targets argument')
            expect(() => Engine.number().alter('x')).to.throw('Invalid targets argument')
            expect(() => Engine.number().alter([])).to.throw('Invalid targets argument')

            expect(() => Engine.number().alter({ xx: 'x' })).to.throw('Alteration adjuster for xx must be a function')
        })
    })

    describe('artifact()', () => {

        it('returns matching artifacts', async () => {

            const sym = Symbol('3')
            const schema = Engine.object({
                a: [
                    Engine.string().artifact(1),
                    Engine.number().artifact('2')
                ],
                b: Engine.boolean().artifact(sym),
                c: {
                    d: {
                        e: Engine.any().artifact(4)
                    }
                },
                f: Engine.array().items(Engine.string(), Engine.number().artifact(0))
            })

            Helper.validate(schema, [
                [{ a: '5', b: true, c: { d: { e: {} } } }, true, { a: '5', b: true, c: { d: { e: {} } } }]
            ])

            expect(schema.validate({ a: '5', b: true, c: { d: { e: {} } } }).artifacts).to.equal(new Map([[1, [['a']]], [sym, [['b']]], [4, [['c', 'd', 'e']]]]))
            expect(schema.validate({ a: 5, c: { d: { e: {} } } }).artifacts).to.equal(new Map([['2', [['a']]], [4, [['c', 'd', 'e']]]]))

            expect((await schema.validateAsync({ a: 5 })).artifacts).to.not.exist()
            expect((await schema.validateAsync({ a: 5 }, { artifacts: true })).artifacts).to.equal(new Map([['2', [['a']]]]))
            expect((await schema.validateAsync({ f: [5, 'x', 6] }, { artifacts: true })).artifacts).to.equal(new Map([[0, [['f', 0], ['f', 2]]]]))
        })
    })

    describe('cast()', () => {

        it('cancels cast', () => {

            const schema = Engine.number().cast('string').cast(false)
            Helper.validate(schema, [
                ['123', true, 123]
            ])
        })
    })

    describe('concat()', () => {

        it('throws when schema is not any', () => {

            expect(() => Engine.string().concat(Engine.number())).to.throw('Cannot merge type string with another type: number')
        })

        it('throws when schema is missing', () => {

            expect(() => Engine.string().concat()).to.throw('Invalid schema object')
        })

        it('throws when schema is invalid', () => {

            expect(() => Engine.string().concat(1)).to.throw('Invalid schema object')
        })

        it('merges two schemas (settings)', () => {

            const a = Engine.number().prefs({ convert: true })
            const b = Engine.prefs({ convert: false })

            Helper.validate(a, [
                [1, true],
                ['1', true, 1]
            ])

            Helper.validate(a.concat(b), [
                [1, true],
                ['1', false, {
                    message: '"value" must be a number',
                    path: [],
                    type: 'number.base',
                    context: { label: 'value', value: '1' }
                }]
            ])
        })

        it('merges two schemas (valid)', () => {

            const a = Engine.string().valid('a')
            const b = Engine.string().valid('b')

            Helper.validate(a, [
                ['a', true],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }]
            ])

            Helper.validate(b, [
                ['b', true],
                ['a', false, {
                    message: '"value" must be [b]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'a', valids: ['b'], label: 'value' }
                }]
            ])

            Helper.validate(a.concat(b), [
                ['a', true],
                ['b', true]
            ])
        })

        it('merges two schemas (invalid)', () => {

            const a = Engine.string().invalid('a')
            const b = Engine.invalid('b')

            Helper.validate(a, [
                ['b', true],
                ['a', false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: 'a', invalids: ['a'], label: 'value' }
                }]
            ])

            Helper.validate(b, [
                ['a', true],
                ['b', false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: 'b', invalids: ['b'], label: 'value' }
                }]
            ])

            Helper.validate(a.concat(b), [
                ['a', false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: 'a', invalids: ['a', 'b'], label: 'value' }
                }],
                ['b', false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: 'b', invalids: ['a', 'b'], label: 'value' }
                }]
            ])
        })

        it('merges two schemas (valid/invalid)', () => {

            const a = Engine.string().valid('a').invalid('b')
            const b = Engine.string().valid('b').invalid('a')

            Helper.validate(a, [
                ['a', true],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }]
            ])

            Helper.validate(b, [
                ['b', true],
                ['a', false, {
                    message: '"value" must be [b]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'a', valids: ['b'], label: 'value' }
                }]
            ])

            Helper.validate(a.concat(b), [
                ['b', true],
                ['a', false, {
                    message: '"value" must be [b]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'a', valids: ['b'], label: 'value' }
                }]
            ])
        })

        it('merges two schemas (tests)', () => {

            const a = Engine.number().min(5)
            const b = Engine.number().max(10)

            Helper.validate(a, [
                [4, false, {
                    message: '"value" must be greater than or equal to 5',
                    path: [],
                    type: 'number.min',
                    context: { limit: 5, value: 4, label: 'value' }
                }],
                [11, true]
            ])

            Helper.validate(b, [
                [6, true],
                [11, false, {
                    message: '"value" must be less than or equal to 10',
                    path: [],
                    type: 'number.max',
                    context: { limit: 10, value: 11, label: 'value' }
                }]
            ])

            Helper.validate(a.concat(b), [
                [4, false, {
                    message: '"value" must be greater than or equal to 5',
                    path: [],
                    type: 'number.min',
                    context: { limit: 5, value: 4, label: 'value' }
                }],
                [6, true],
                [11, false, {
                    message: '"value" must be less than or equal to 10',
                    path: [],
                    type: 'number.max',
                    context: { limit: 10, value: 11, label: 'value' }
                }]
            ])
        })

        it('merges two schemas (overlap rules)', () => {

            const a = Engine.number().min(5)
            const b = Engine.number().min(10)

            Helper.validate(a.concat(b), [
                [11, true],
                [4, false, {
                    message: '"value" must be greater than or equal to 10',
                    path: [],
                    type: 'number.min',
                    context: { limit: 10, value: 4, label: 'value' }
                }],
                [6, false, {
                    message: '"value" must be greater than or equal to 10',
                    path: [],
                    type: 'number.min',
                    context: { limit: 10, value: 6, label: 'value' }
                }]
            ])
        })

        it('merges two schemas (flags)', () => {

            const a = Engine.string().valid('a')
            const b = Engine.string().insensitive()

            Helper.validate(a, [
                ['a', true],
                ['A', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'A', valids: ['a'], label: 'value' }
                }],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }]
            ])

            Helper.validate(a.concat(b), [
                ['a', true, 'a'],
                ['A', true, 'a'],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }]
            ])
        })

        it('merges two schemas (flags with empty on both sides)', () => {

            const a = Engine.string().valid('a').empty('')
            const b = Engine.string().insensitive().empty(' ')

            Helper.validate(a, [
                ['a', true],
                ['A', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'A', valids: ['a'], label: 'value' }
                }],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }],
                ['', true, undefined],
                [' ', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: ' ', valids: ['a'], label: 'value' }
                }]
            ])

            const ab = a.concat(b)
            Helper.validate(ab, [
                ['a', true, 'a'],
                ['A', true, 'a'],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }],
                ['', true, undefined],
                [' ', true, undefined]
            ])

            expect(ab.describe()).to.equal({
                type: 'string',
                flags: {
                    only: true,
                    empty: {
                        type: 'any',
                        flags: { only: true },
                        allow: ['', ' ']
                    },
                    insensitive: true
                },
                allow: ['a']
            })
        })

        it('merges two schemas (flags with empty on one side)', () => {

            const a = Engine.string().valid('a').empty('')
            const b = Engine.string().insensitive()

            Helper.validate(a, [
                ['a', true],
                ['A', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'A', valids: ['a'], label: 'value' }
                }],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }],
                ['', true, undefined],
                [' ', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: ' ', valids: ['a'], label: 'value' }
                }]
            ])

            const ab = a.concat(b)
            Helper.validate(ab, [
                ['a', true, 'a'],
                ['A', true, 'a'],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }],
                ['', true, undefined],
                [' ', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: ' ', valids: ['a'], label: 'value' }
                }]
            ])

            expect(ab.describe()).to.equal({
                type: 'string',
                flags: {
                    only: true,
                    empty: {
                        type: 'any',
                        flags: { only: true },
                        allow: ['']
                    },
                    insensitive: true
                },
                allow: ['a']
            })

            const ba = b.concat(a)
            Helper.validate(ba, [
                ['a', true, 'a'],
                ['A', true, 'a'],
                ['b', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'b', valids: ['a'], label: 'value' }
                }],
                ['', true, undefined],
                [' ', false, {
                    message: '"value" must be [a]',
                    path: [],
                    type: 'any.only',
                    context: { value: ' ', valids: ['a'], label: 'value' }
                }]
            ])

            expect(ba.describe()).to.equal({
                type: 'string',
                flags: {
                    only: true,
                    empty: {
                        type: 'any',
                        flags: { only: true },
                        allow: ['']
                    },
                    insensitive: true
                },
                allow: ['a']
            })
        })

        it('overrides and append information', () => {

            const a = Engine.any().description('a').unit('a').tag('a').example('a')
            const b = Engine.any().description('b').unit('b').tag('b').example('b')

            const desc = a.concat(b).describe()
            expect(desc).to.equal({
                type: 'any',
                tags: ['a', 'b'],
                examples: ['a', 'b'],
                flags: {
                    description: 'b',
                    unit: 'b'
                }
            })
        })

        it('merges two objects (any key + specific key)', () => {

            const a = Engine.object()
            const b = Engine.object({ b: 1 })

            Helper.validate(a, [
                [{ b: 1 }, true],
                [{ b: 2 }, true]
            ])

            Helper.validate(b, [
                [{ b: 1 }, true],
                [{ b: 2 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }]
            ])

            Helper.validate(a.concat(b), [
                [{ b: 1 }, true],
                [{ b: 2 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }]
            ])

            Helper.validate(b.concat(a), [
                [{ b: 1 }, true],
                [{ b: 2 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }]
            ])
        })

        it('merges two objects (no key + any key)', () => {

            const a = Engine.object({})
            const b = Engine.object()

            Helper.validate(a, [
                [{}, true],
                [{ b: 2 }, false, {
                    message: '"b" is not allowed',
                    path: ['b'],
                    type: 'object.unknown',
                    context: { child: 'b', label: 'b', key: 'b', value: 2 }
                }]
            ])

            Helper.validate(b, [
                [{}, true],
                [{ b: 2 }, true]
            ])

            Helper.validate(a.concat(b), [
                [{}, true],
                [{ b: 2 }, false, {
                    message: '"b" is not allowed',
                    path: ['b'],
                    type: 'object.unknown',
                    context: { child: 'b', label: 'b', key: 'b', value: 2 }
                }]
            ])

            Helper.validate(b.concat(a), [
                [{}, true],
                [{ b: 2 }, false, {
                    message: '"b" is not allowed',
                    path: ['b'],
                    type: 'object.unknown',
                    context: { child: 'b', label: 'b', key: 'b', value: 2 }
                }]
            ])
        })

        it('merges two objects (key + key)', () => {

            const a = Engine.object({ a: 1 })
            const b = Engine.object({ b: 2 })

            Helper.validate(a, [
                [{ a: 1 }, true],
                [{ b: 2 }, false, {
                    message: '"b" is not allowed',
                    path: ['b'],
                    type: 'object.unknown',
                    context: { child: 'b', label: 'b', key: 'b', value: 2 }
                }]
            ])

            Helper.validate(b, [
                [{ a: 1 }, false, {
                    message: '"a" is not allowed',
                    path: ['a'],
                    type: 'object.unknown',
                    context: { child: 'a', label: 'a', key: 'a', value: 1 }
                }],
                [{ b: 2 }, true]
            ])

            Helper.validate(a.concat(b), [
                [{ a: 1 }, true],
                [{ b: 2 }, true]
            ])

            Helper.validate(b.concat(a), [
                [{ a: 1 }, true],
                [{ b: 2 }, true]
            ])
        })

        it('merges two objects (renames)', () => {

            const a = Engine.object({ a: 1 }).rename('c', 'a')
            const b = Engine.object({ b: 2 }).rename('d', 'b')

            const schema = a.concat(b)
            Helper.validate(schema, [
                [{ c: 1, d: 2 }, true, { a: 1, b: 2 }]
            ])
        })

        it('merges two objects (deps)', () => {

            const a = Engine.object({ a: 1 })
            const b = Engine.object({ b: 2 }).and('b', 'a')

            const schema = a.concat(b)
            Helper.validate(schema, [
                [{ a: 1, b: 2 }, true]
            ])
        })

        it('merges two objects (same key)', () => {

            const a = Engine.object({ a: Engine.valid(1), b: Engine.valid(2), c: Engine.valid(3) })
            const b = Engine.object({ b: Engine.valid(1), c: Engine.valid(2), a: Engine.valid(3) })

            const ab = a.concat(b)

            Helper.validate(a, [
                [{ a: 1, b: 2, c: 3 }, true],
                [{ a: 3, b: 1, c: 2 }, false, {
                    message: '"a" must be [1]',
                    path: ['a'],
                    type: 'any.only',
                    context: { value: 3, valids: [1], label: 'a', key: 'a' }
                }]
            ])

            Helper.validate(b, [
                [{ a: 1, b: 2, c: 3 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }],
                [{ a: 3, b: 1, c: 2 }, true]
            ])

            Helper.validate(ab, [
                [{ a: 1, b: 2, c: 3 }, true],
                [{ a: 3, b: 1, c: 2 }, true],
                [{ a: 1, b: 2, c: 2 }, true],
                [{ a: 1, b: 2, c: 4 }, false, {
                    message: '"c" must be one of [3, 2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 4, valids: [3, 2], label: 'c', key: 'c' }
                }]
            ])
        })

        it('merges two objects (same key, implicit override)', () => {

            const a = Engine.object({ a: 1, b: 2, c: 3 })
            const b = Engine.object({ b: 1, c: 2, a: 3 })

            const ab = a.concat(b)

            Helper.validate(a, [
                [{ a: 1, b: 2, c: 3 }, true],
                [{ a: 3, b: 1, c: 2 }, false, {
                    message: '"a" must be [1]',
                    path: ['a'],
                    type: 'any.only',
                    context: { value: 3, valids: [1], label: 'a', key: 'a' }
                }]
            ])

            Helper.validate(b, [
                [{ a: 3, b: 1, c: 2 }, true],
                [{ a: 1, b: 2, c: 3 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }]
            ])

            Helper.validate(ab, [
                [{ a: 3, b: 1, c: 2 }, true],
                [{ b: 2, c: 3 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 2, c: 3 }, false, {
                    message: '"a" must be [3]',
                    path: ['a'],
                    type: 'any.only',
                    context: { value: 1, valids: [3], label: 'a', key: 'a' }
                }]
            ])
        })

        it('merges two objects (same key, explicit override)', () => {

            const a = Engine.object({ a: Engine.valid(Engine.override, 1), b: Engine.valid(Engine.override, 2), c: Engine.valid(Engine.override, 3) })
            const b = Engine.object({ b: Engine.valid(Engine.override, 1), c: Engine.valid(Engine.override, 2), a: Engine.valid(Engine.override, 3) })

            const ab = a.concat(b)

            Helper.validate(a, [
                [{ a: 1, b: 2, c: 3 }, true],
                [{ a: 3, b: 1, c: 2 }, false, {
                    message: '"a" must be [1]',
                    path: ['a'],
                    type: 'any.only',
                    context: { value: 3, valids: [1], label: 'a', key: 'a' }
                }]
            ])

            Helper.validate(b, [
                [{ a: 3, b: 1, c: 2 }, true],
                [{ a: 1, b: 2, c: 3 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }]
            ])

            Helper.validate(ab, [
                [{ a: 3, b: 1, c: 2 }, true],
                [{ b: 2, c: 3 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 2, c: 3 }, false, {
                    message: '"a" must be [3]',
                    path: ['a'],
                    type: 'any.only',
                    context: { value: 1, valids: [3], label: 'a', key: 'a' }
                }]
            ])
        })

        it('throws when schema key types do not match', () => {

            const a = Engine.object({ a: Engine.number() })
            const b = Engine.object({ a: Engine.string() })

            expect(() => a.concat(b)).to.throw('Cannot merge type number with another type: string')
        })

        it('merges two alternatives with references', () => {

            const ref1 = Engine.ref('a.c')
            const ref2 = Engine.ref('c')
            const schema = Engine.object({
                a: { c: Engine.number() },
                b: Engine.alternatives(ref1).concat(Engine.alternatives(ref2)),
                c: Engine.number()
            })

            Helper.validate(schema, [
                [{ a: {} }, true],
                [{ a: { c: '5' }, b: 5 }, true, { a: { c: 5 }, b: 5 }],
                [{ a: { c: '5' }, b: 6, c: '6' }, true, { a: { c: 5 }, b: 6, c: 6 }],
                [{ a: { c: '5' }, b: 7, c: '6' }, false, {
                    message: '"b" must be one of [ref:a.c, ref:c]',
                    type: 'alternatives.types',
                    path: ['b'],
                    context: {
                        key: 'b',
                        label: 'b',
                        value: 7,
                        types: [ref1, ref2]
                    }
                }]
            ])
        })

        it('merges meta properly', () => {

            const metaA = { a: 1 }
            const metaB = { b: 1 }
            const a = Engine.any().meta(metaA)
            const b = Engine.any().meta(metaB)
            const c = Engine.any()
            const d = Engine.any()

            expect(a.concat(b).describe().metas).to.equal([{ a: 1 }, { b: 1 }])
            expect(a.concat(c).describe().metas).to.equal([metaA])
            expect(b.concat(c).describe().metas).to.equal([metaB])
            expect(c.concat(d).describe().metas).to.not.exist()
        })

        it('merges into an any', () => {

            const a = Engine.any().required()
            const b = Engine.number().valid(0)

            expect(() => a.concat(b)).to.not.throw()

            const schema = a.concat(b)
            Helper.validate(schema, [
                [undefined, false, {
                    message: '"value" is required',
                    path: [],
                    type: 'any.required',
                    context: { label: 'value' }
                }],
                [1, false, {
                    message: '"value" must be [0]',
                    path: [],
                    type: 'any.only',
                    context: { value: 1, valids: [0], label: 'value' }
                }]
            ])
        })
    })

    describe('default()', () => {

        it('sets the value', () => {

            const schema = Engine.object({ foo: Engine.string().default('test') })
            Helper.validate(schema, [
                [{}, true, { foo: 'test' }]
            ])
        })

        it('allows passing description as a property of a default method', () => {

            const defaultFn = function () {

                return 'test'
            }

            defaultFn.description = 'test'

            expect(() => Engine.object({ foo: Engine.string().default(defaultFn) })).to.not.throw()
        })

        it('sets the value when passing a method', () => {

            const schema = Engine.object({
                foo: Engine.string().default(() => {

                    return 'test'
                })
            })

            Helper.validate(schema, [
                [{}, true, { foo: 'test' }]
            ])
        })

        it('executes the default method each time validate is called', () => {

            let count = 0
            const schema = Engine.object({
                foo: Engine.number().default(() => ++count)
            })

            const input = {}
            expect(schema.validate(input)).to.equal({ value: { foo: 1 } })
            expect(schema.validate(input)).to.equal({ value: { foo: 2 } })
        })

        it('passes a clone of the parent if the default method accepts an argument', () => {

            const schema = Engine.object({
                foo: Engine.string().default((parent, { prefs }) => {

                    expect(prefs.abortEarly).to.be.true()
                    return parent.bar + 'ing'
                }),
                bar: Engine.string()
            })

            Helper.validate(schema, [
                [{ bar: 'test' }, true, { bar: 'test', foo: 'testing' }]
            ])
        })

        it('does not modify the original object when modifying the clone in a default method', () => {

            const defaultFn = function (parent) {

                parent.bar = 'broken'
                return 'test'
            }

            defaultFn.description = 'testing'

            const schema = Engine.object({
                foo: Engine.string().default(defaultFn),
                bar: Engine.string()
            })

            Helper.validate(schema, [
                [{ bar: 'test' }, true, { bar: 'test', foo: 'test' }]
            ])
        })

        it('passes undefined as the parent if the default method has no parent', () => {

            let c
            let methodCalled = false
            const schema = Engine.string().default((parent) => {

                methodCalled = true
                c = parent
                return 'test'
            })

            Helper.validate(schema, [
                [undefined, true, 'test']
            ])

            expect(methodCalled).to.equal(true)
            expect(c).to.equal(undefined)
        })

        it('sets literal function default', () => {

            const func = () => 'just a function'
            const schema = Engine.function().default(func, { literal: true })

            Helper.validate(schema, [
                [undefined, true, func]
            ])
        })

        it('allows passing a method that generates a default method when validating a function', () => {

            const defaultFn = function () {

                return 'just a function'
            }

            const defaultGeneratorFn = function () {

                return defaultFn
            }

            const schema = Engine.function().default(defaultGeneratorFn)
            Helper.validate(schema, [[undefined, true, defaultFn]])
        })

        it('allows passing a ref as a default without a description', () => {

            const schema = Engine.object({
                a: Engine.string(),
                b: Engine.string().default(Engine.ref('a'))
            })

            Helper.validate(schema, [[{ a: 'test' }, true, { a: 'test', b: 'test' }]])
        })

        it('ignores description when passing a ref as a default', () => {

            const schema = Engine.object({
                a: Engine.string(),
                b: Engine.string().default(Engine.ref('a'))
            })

            Helper.validate(schema, [[{ a: 'test' }, true, { a: 'test', b: 'test' }]])
        })

        it('catches errors in default methods', () => {

            const error = new Error('boom')
            const defaultFn = function () {

                throw error
            }

            defaultFn.description = 'broken method'

            const schema = Engine.string().default(defaultFn)

            Helper.validate(schema, [
                [undefined, false, {
                    message: '"value" threw an error when running default method',
                    path: [],
                    type: 'any.default',
                    context: { error, label: 'value', value: null }
                }]
            ])
        })

        it('should not override a value when value is given', () => {

            const schema = Engine.object({ foo: Engine.string().default('bar') })
            const input = { foo: 'test' }
            Helper.validate(schema, [[input, true, { foo: 'test' }]])
        })

        it('sets value based on condition (outer)', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean()
                    .default(false)
                    .when('a', { is: true, then: Engine.required(), otherwise: Engine.forbidden() })
            })

            Helper.validate(schema, [[{ a: false }, true, { a: false, b: false }]])
        })

        it('sets value based on condition (inner)', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean().when('a', { is: true, then: Engine.any().default(false), otherwise: Engine.forbidden() })
            })

            Helper.validate(schema, [[{ a: true }, true, { a: true, b: false }]])
        })

        it('creates deep defaults', () => {

            const schema = Engine.object({
                a: Engine.number().default(42),
                b: Engine.object({
                    c: Engine.boolean().default(true),
                    d: Engine.string()
                })
                    .default()
            })
                .default()

            Helper.validate(schema, [
                [undefined, true, { a: 42, b: { c: true } }],
                [{ a: 24 }, true, { a: 24, b: { c: true } }]
            ])
        })

        it('errors when missing value on non-object schemas', () => {

            expect(() => Engine.number().default()).to.throw('Missing default value')
        })

        it('should set default value as a clone', () => {

            const defaultValue = { bar: 'val' }
            const schema = Engine.object({ foo: Engine.object().default(defaultValue) })
            const input = {}

            const value = schema.validate(input).value
            expect(value.foo).to.not.shallow.equal(defaultValue)
            expect(value.foo).to.only.include({ bar: 'val' })

            value.foo.bar = 'mutated'

            const value2 = schema.validate(input).value
            expect(value2.foo).to.not.shallow.equal(defaultValue)
            expect(value2.foo).to.only.include({ bar: 'val' })
        })

        it('should not apply default values if the noDefaults option is enquire', () => {

            const schema = Engine.object({
                a: Engine.string().default('foo'),
                b: Engine.number()
            })

            const input = { b: 42 }
            Helper.validate(schema, { noDefaults: true }, [[input, true, { b: 42 }]])
        })

        it('should not apply default values from functions if the noDefaults option is enquire', () => {

            const func = function () {

                return 'foo'
            }

            func.description = 'test parameter'

            const schema = Engine.object({
                a: Engine.string().default(func),
                b: Engine.number()
            })

            const input = { b: 42 }
            Helper.validate(schema, { noDefaults: true }, [[input, true, { b: 42 }]])
        })

        it('should not apply default values from references if the noDefaults option is enquire', () => {

            const schema = Engine.object({
                a: Engine.string().default(Engine.ref('b')),
                b: Engine.number()
            })

            const input = { b: 42 }
            Helper.validate(schema, { noDefaults: true }, [[input, true, { b: 42 }]])
        })

        it('should be able to support both empty and noDefaults', () => {

            const schema = Engine.object({
                a: Engine.string().empty('foo').default('bar'),
                b: Engine.number()
            })

            const input = { a: 'foo', b: 42 }
            Helper.validate(schema, { noDefaults: true }, [[input, true, { b: 42 }]])
        })
    })

    describe('description()', () => {

        it('sets the description', () => {

            const b = Engine.any().description('my description')
            expect(b.describe().flags.description).to.equal('my description')
        })

        it('throws when description is missing', () => {

            expect(() => Engine.any().description()).to.throw('Description must be a non-empty string')
        })
    })

    describe('empty()', () => {

        it('should void values when considered empty', () => {

            const schema = Engine.string().empty('')
            Helper.validate(schema, [
                [undefined, true, undefined],
                ['abc', true, 'abc'],
                ['', true, undefined]
            ])
        })

        it('should void values with trim', () => {

            const schema = Engine.string().empty('').trim()
            Helper.validate(schema, [
                [undefined, true, undefined],
                ['abc', true, 'abc'],
                ['', true, undefined],
                [' ', true, undefined],
                ['       ', true, undefined],
                [42, false, {
                    message: '"value" must be a string',
                    path: [],
                    type: 'string.base',
                    context: { value: 42, label: 'value' }
                }]
            ])

            Helper.validate(schema.trim(false), [
                [undefined, true, undefined],
                ['abc', true, 'abc'],
                ['', true, undefined],
                [' ', true, ' ']
            ])
        })

        it('should override any previous empty', () => {

            const schema = Engine.string().empty('').empty('abc')
            Helper.validate(schema, [
                [undefined, true, undefined],
                ['abc', true, undefined],
                ['', false, {
                    message: '"value" is not allowed to be empty',
                    path: [],
                    type: 'string.empty',
                    context: { value: '', label: 'value' }
                }],
                ['def', true, 'def']
            ])
        })

        it('should be possible to reset the empty value', () => {

            const schema = Engine.string().empty('').empty()
            Helper.validate(schema, [
                [undefined, true, undefined],
                ['abc', true, 'abc'],
                ['', false, {
                    message: '"value" is not allowed to be empty',
                    path: [],
                    type: 'string.empty',
                    context: { value: '', label: 'value' }
                }]
            ])
        })

        it('should have no effect if only reset is used', () => {

            const schema = Engine.string().empty()
            Helper.validate(schema, [
                [undefined, true, undefined],
                ['abc', true, 'abc'],
                ['', false, {
                    message: '"value" is not allowed to be empty',
                    path: [],
                    type: 'string.empty',
                    context: { value: '', label: 'value' }
                }]
            ])
        })

        it('should remove empty flag if only reset is used', () => {

            const schema = Engine.string().empty('').empty()
            expect(schema._flags.empty).to.not.exist()
            expect(schema.describe().flags).to.not.exist()
        })

        it('should work with dependencies', () => {

            const schema = Engine.object({
                a: Engine.string().empty(''),
                b: Engine.string().empty('')
            }).or('a', 'b')

            Helper.validate(schema, [
                [{}, false, {
                    message: '"value" must contain at least one of [a, b]',
                    path: [],
                    type: 'object.missing',
                    context: {
                        peers: ['a', 'b'],
                        peersWithLabels: ['a', 'b'],
                        label: 'value',
                        value: {}
                    }
                }],
                [{ a: '' }, false, {
                    message: '"value" must contain at least one of [a, b]',
                    path: [],
                    type: 'object.missing',
                    context: {
                        peers: ['a', 'b'],
                        peersWithLabels: ['a', 'b'],
                        label: 'value',
                        value: {}
                    }
                }],
                [{ a: 'a' }, true, { a: 'a' }],
                [{ a: '', b: 'b' }, true, { b: 'b' }]
            ])
        })

        it('supports references', () => {

            const schema = Engine.object({
                empty: Engine.string(),
                a: Engine.string().empty(Engine.ref('empty'))
            })

            Helper.validate(schema, [
                [{ empty: 'x', a: 'x' }, true, { empty: 'x' }],
                [{ empty: 'y', a: 'x' }, true, { empty: 'y', a: 'x' }]
            ])
        })
    })

    describe('equal()', () => {

        it('validates valid values', () => {

            Helper.validate(Engine.equal(4), [
                [4, true],
                [5, false, {
                    message: '"value" must be [4]',
                    path: [],
                    type: 'any.only',
                    context: { value: 5, valids: [4], label: 'value' }
                }]
            ])
        })
    })

    describe('error()', () => {

        it('returns custom error', () => {

            const schema = Engine.object({
                a: Engine.string(),
                b: {
                    c: Engine.number().strict().error(new Error('Really wanted a number!'))
                }
            })

            const err = schema.validate({ a: 'abc', b: { c: 'x' } }).error
            expect(Engine.isError(err)).to.be.false()
            expect(err.message).to.equal('Really wanted a number!')
            expect(err.details).to.not.exist()
        })

        it('returns first custom error with multiple errors', () => {

            const schema = Engine.object({
                a: Engine.string(),
                b: {
                    c: Engine.number().error(new Error('Really wanted a number!'))
                }
            }).prefs({ abortEarly: false })

            const err = schema.validate({ a: 22, b: { c: 'x' } }).error
            expect(Engine.isError(err)).to.be.false()
            expect(err.message).to.equal('Really wanted a number!')
            expect(err.details).to.not.exist()
        })

        it('returns first error with multiple errors (first not custom)', () => {

            const schema = Engine.object({
                a: Engine.string(),
                b: {
                    c: Engine.number().error(new Error('Really wanted a number!'))
                }
            })

            const err = schema.validate({ a: 22, b: { c: 'x' } }).error
            expect(Engine.isError(err)).to.be.true()
            expect(err.message).to.equal('"a" must be a string')
            expect(err.details).to.equal([{
                message: '"a" must be a string',
                path: ['a'],
                type: 'string.base',
                context: { value: 22, label: 'a', key: 'a' }
            }])
        })

        it('errors on invalid error option', () => {

            expect(() => {

                Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().error('Really wanted a number!')
                    }
                })
            }).to.throw('Must provide a valid Error object or a function')
        })

        it('errors on missing error option', () => {

            expect(() => {

                Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().error()
                    }
                })
            }).to.throw('Missing error')
        })

        describe('with a function', () => {

            it('replaces the error message with an error', () => {

                const schema = Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().strict().error(() => new Error('Really wanted a number!'))
                    }
                })

                const err = schema.validate({ a: 'abc', b: { c: 'x' } }).error
                expect(Engine.isError(err)).to.be.false()
                expect(err.message).to.equal('Really wanted a number!')
            })

            it('should be able to combine several error messages', () => {

                const schema = Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().min(0).integer().strict().error((errors) => {

                            return new Error(errors.join(' and ')) // Automatic toString() of each error on join
                        })
                    }
                })

                const err = schema.validate({ a: 'abc', b: { c: -1.5 } }, { abortEarly: false }).error
                expect(Engine.isError(err)).to.be.false()
                expect(err.message).to.equal('"b.c" must be greater than or equal to 0 and "b.c" must be an integer')
            })

            it('caches report message string', () => {

                const schema = Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().min(0).integer().strict().error((errors) => {

                            for (const err of errors) {
                                err.toString()
                                err.message += '!'
                            }

                            return new Error(errors.join(' and ')) // Automatic toString() of each error on join
                        })
                    }
                })

                const err = schema.validate({ a: 'abc', b: { c: -1.5 } }, { abortEarly: false }).error
                expect(Engine.isError(err)).to.be.false()
                expect(err.message).to.equal('"b.c" must be greater than or equal to 0! and "b.c" must be an integer!')
            })

            it('uses selected date format', () => {

                const min = new Date('1974-05-07')

                const schema = Engine.object({
                    a: Engine.date().min(min).greater(min).error((errors) => {

                        return new Error(errors.join(' and ')) // Automatic toString() of each error on join
                    })
                })

                const err = schema.validate({ a: new Date('1973-01-01') }, { dateFormat: 'date', abortEarly: false }).error
                expect(Engine.isError(err)).to.be.false()
                expect(err.message).to.equal(`"a" must be greater than or equal to "${min.toDateString()}" and "a" must be greater than "${min.toDateString()}"`)
            })

            it('should be able to combine several error messages using context', () => {

                const schema = Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().min(0).integer().strict().error((errors) => {

                            const message = errors.reduce((memo, error) => {

                                let text = memo ? ' && ' : ''
                                switch (error.code) {
                                    case 'number.base':
                                        text += `"${error.local.key}" ∈ ℝ`
                                        break
                                    case 'number.min':
                                        text += `"${error.local.key}" > ${error.local.limit}`
                                        break
                                    case 'number.integer':
                                        text += `"${error.local.key}" ∈ ℤ`
                                        break
                                }

                                return memo + text
                            }, '')

                            return new Error(message)
                        })
                    }
                })

                const err = schema.validate({ a: 'abc', b: { c: -1.5 } }, { abortEarly: false }).error
                expect(Engine.isError(err)).to.be.false()
                expect(err.message).to.equal('"c" > 0 && "c" ∈ ℤ')
            })

            it('should be able to return a javascript Error', () => {

                const schema = Engine.object({
                    a: Engine.string(),
                    b: {
                        c: Engine.number().min(0).integer().strict().error((errors) => new Error(`error of type ${errors[0].code}`))
                    }
                })

                const err = schema.validate({ a: 'abc', b: { c: -1.5 } }, { abortEarly: false }).error
                expect(err).to.be.an.error('error of type number.min')
                expect(Engine.isError(err)).to.be.false()
                expect(err.details).to.not.exist()
            })

            it('handles multiple errors return value', () => {

                const item = Engine.string()
                    .trim()
                    .regex(/^\w*$/)
                    .error((errors) => {

                        const error = errors[0]
                        if (error.code === 'string.pattern.base') {
                            error.message = 'my new error message'
                        }

                        return errors
                    })

                const schema = Engine.object({
                    a: Engine.array().items(item.min(2).max(64)),
                    b: item
                })

                expect(schema.validate({ a: [' xx', 'yy'], b: ' x' }).value).to.equal({ a: ['xx', 'yy'], b: 'x' })

                const result1 = schema.validate({ a: [' xx', 'yy'], b: ' x?' })
                expect(result1.value).to.equal({ a: ['xx', 'yy'], b: ' x?' })
                expect(result1.error).to.be.an.error('my new error message')

                const result2 = schema.validate({ a: [' xx', 'yy?'], b: ' x' })
                expect(result2.value).to.equal({ a: [' xx', 'yy?'], b: ' x' })
                expect(result2.error).to.be.an.error('my new error message')
            })

            it('errors on invalid error function', () => {

                const schema = Engine.number().error(() => 'not an Error')

                expect(() => schema.validate('x')).to.throw('error() must return an Error object')
            })
        })
    })

    describe('example()', () => {

        it('sets an example', () => {

            const schema = Engine.valid(5, 6, 7).example(5)
            expect(schema.describe().examples).to.equal([5])
        })

        it('appends examples', () => {

            const schema = Engine.valid(5, 6, 7).example(4).example(5)
            expect(schema.describe().examples).to.equal([4, 5])
        })

        it('overrides example', () => {

            const schema = Engine.valid(5, 6, 7).example(4).example(5, { override: true })
            expect(schema.describe().examples).to.equal([5])
        })

        it('does not flatten examples', () => {

            const schema = Engine.array().items(5, 6, 7).example([5, 6])
            expect(schema.describe().examples).to.equal([[5, 6]])
        })

        it('throws when examples are missing', () => {

            expect(() => Engine.any().example()).to.throw('Missing example')
        })
    })

    describe('exist()', () => {

        it('validates required values', () => {

            Helper.validate(Engine.exist(), [
                [0, true],
                [null, true],
                ['', true],
                [false, true],
                [undefined, false, {
                    message: '"value" is required',
                    path: [],
                    type: 'any.required',
                    context: { label: 'value' }
                }]
            ])
        })
    })

    describe('external()', () => {

        it('errors on invalid arguments', () => {

            const method = () => null
            expect(() => Engine.any().external(method, '')).to.throw('Description must be a non-empty string')
            expect(() => Engine.any().external(method, 0)).to.throw('Description must be a non-empty string')
            expect(() => Engine.any().external(method, [])).to.throw('Description must be a non-empty string')
            expect(() => Engine.any().external({ method }, 'text')).to.throw('Cannot combine options with description')
        })

        it('includes description in manifest', () => {

            const method = () => null
            const schema = Engine.any().external(method, 'some description')
            expect(schema.describe()).to.equal({
                type: 'any',
                externals: [
                    {
                        description: 'some description',
                        method
                    }
                ]
            })
        })

        it('does not run on invalid array items', async () => {

            const schema = Engine.array().items(
                Engine.string().min(5).external((value) => value + value),
                Engine.string().external((value) => value + '-')
            )

            expect(await schema.validateAsync(['x'])).to.equal(['x-'])
        })

        it('does not run on invalid alternatives', async () => {

            const schema = Engine.alternatives(
                Engine.string().min(5).external((value) => value + value),
                Engine.string().external((value) => value + '-')
            )

            expect(await schema.validateAsync('x')).to.equal('x-')
        })

        it('does not run on invalid alternatives with match mode "one"', async () => {

            const schema = Engine.alternatives().try(
                Engine.string().min(5).external((value) => value + value),
                Engine.string().external((value) => value + '-')
            ).match('one')

            expect(await schema.validateAsync('x')).to.equal('x-')
        })
    })

    describe('failover()', () => {

        it('sets value on error', () => {

            const schema = Engine.object({ x: Engine.number().default(1).failover(2) })

            Helper.validate(schema, [
                [{}, true, { x: 1 }],
                [{ x: 3 }, true, { x: 3 }],
                [{ x: [] }, true, { x: 2 }]
            ])
        })
    })

    describe('forbidden()', () => {

        it('validates forbidden', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.forbidden()
            })

            Helper.validate(schema, [
                [{ a: 5 }, true],
                [{ a: 5, b: 6 }, false, {
                    message: '"b" is not allowed',
                    path: ['b'],
                    type: 'any.unknown',
                    context: { label: 'b', key: 'b', value: 6 }
                }],
                [{ a: 'a' }, false, {
                    message: '"a" must be a number',
                    path: ['a'],
                    type: 'number.base',
                    context: { label: 'a', key: 'a', value: 'a' }
                }],
                [{}, true],
                [{ b: undefined }, true],
                [{ b: null }, false, {
                    message: '"b" is not allowed',
                    path: ['b'],
                    type: 'any.unknown',
                    context: { label: 'b', key: 'b', value: null }
                }]
            ])
        })

        it('avoids unnecessary cloning when called twice', () => {

            const schema = Engine.any().forbidden()
            expect(schema.forbidden()).to.shallow.equal(schema)
        })
    })

    describe('invalid()', () => {

        it('allows invalid values to be set', () => {

            expect(() => Engine.any().valid(true, 1, 'hello', new Date(), Symbol('foo'))).not.to.throw()
        })

        it('throws when passed undefined', () => {

            expect(() => {

                Engine.any().invalid(undefined)
            }).to.throw('Cannot call allow/valid/invalid with undefined')
        })

        it('preserves passed value when cloned', () => {

            const o = {}
            Helper.validate(Engine.object().invalid(o).clone(), [[o, false, '"value" contains an invalid value']])
            Helper.validate(Engine.object().invalid({}).clone(), [[{}, false, '"value" contains an invalid value']])
        })

        it('errors on blocked schema', () => {

            expect(() => Engine.any().valid(1).invalid(1)).to.throw('Setting invalid value 1 leaves schema rejecting all values due to previous valid rule')
            expect(() => Engine.any().allow(1).invalid(1)).to.not.throw()
        })

        it('appends invalid values', () => {

            const schema = Engine.any().invalid(1).invalid(2)
            expect(schema.describe()).to.equal({ type: 'any', invalid: [1, 2] })
        })

        it('throws when override is not first item', () => {

            expect(() => Engine.any().invalid(1, Engine.override)).to.throw('Override must be the first value')
        })

        it('overrides previous values', () => {

            const schema = Engine.number().invalid(2).invalid(Engine.override, 1)
            Helper.validate(schema, [
                [1, false, '"value" contains an invalid value'],
                [2, true, 2]
            ])
        })

        it('cancels previous values', () => {

            const schema = Engine.number().invalid(2).invalid(Engine.override)
            Helper.validate(schema, [
                [1, true, 1],
                [2, true, 2]
            ])
        })

        it('ignores empty override', () => {

            const schema = Engine.invalid(Engine.override)
            expect(schema._invalids).to.be.null()
        })
    })

    describe('keep()', () => {

        it('retains both unique rule instances', () => {

            const schema = Engine.number()
                .min(10).keep()
                .min(100)

            Helper.validate(schema, { abortEarly: false }, [[1, false, '"value" must be greater than or equal to 10. "value" must be greater than or equal to 100']])
        })

        it('retains both unique rule instances in concat', () => {

            const schema = Engine.number()
                .min(10).keep()
                .concat(Engine.number().min(100))

            Helper.validate(schema, { abortEarly: false }, [[1, false, '"value" must be greater than or equal to 10. "value" must be greater than or equal to 100']])
        })
    })

    describe('label()', () => {

        it('adds to existing options', () => {

            const schema = Engine.object({ b: Engine.string().email().label('Custom label') })
            const input = { b: 'not_a_valid_email' }
            Helper.validate(schema, [[input, false, {
                message: '"Custom label" must be a valid email',
                path: ['b'],
                type: 'string.email',
                context: { value: 'not_a_valid_email', invalids: ['not_a_valid_email'], label: 'Custom label', key: 'b' }
            }]])
        })

        it('throws when label is missing', () => {

            expect(() => {

                Engine.any().label()
            }).to.throw('Label name must be a non-empty string')
        })

        it('can describe a label', () => {

            const schema = Engine.object().label('lbl').describe()
            expect(schema).to.equal({ type: 'object', flags: { label: 'lbl' } })
        })

        it('does not leak into sub objects', () => {

            const schema = Engine.object({ a: Engine.number() }).label('foo')
            Helper.validate(schema, [[{ a: 'a' }, false, {
                message: '"a" must be a number',
                path: ['a'],
                type: 'number.base',
                context: { label: 'a', key: 'a', value: 'a' }
            }]])
        })

        it('does not leak into sub objects from an array', () => {

            const schema = Engine.array().items(
                Engine.object({ a: Engine.number() }).label('foo')
            ).label('bar')

            Helper.validate(schema, [[[{ a: 'a' }], false, {
                message: '"[0].a" must be a number',
                path: [0, 'a'],
                type: 'number.base',
                context: { label: '[0].a', key: 'a', value: 'a' }
            }]])
        })

        it('does not leak into unknown keys', () => {

            const schema = Engine.object({ a: Engine.number() }).label('foo')
            Helper.validate(schema, [[{ b: 'a' }, false, {
                message: '"b" is not allowed',
                path: ['b'],
                type: 'object.unknown',
                context: { child: 'b', label: 'b', key: 'b', value: 'a' }
            }]])
        })

        it('applies only to hierarchy edge', () => {

            const schema = Engine.object({
                a: Engine.object({
                    b: Engine.object({
                        c: Engine.number().label('C')
                    }).label('B')
                }).label('A')
            })

            Helper.validate(schema, [[{ a: { b: { c: 'x' } } }, false, {
                message: '"C" must be a number',
                path: ['a', 'b', 'c'],
                type: 'number.base',
                context: { label: 'C', value: 'x', key: 'c' }
            }]])
        })
    })

    describe('message()', () => {

        it('overrides message', () => {

            const schema = Engine.number()
                .min(10).message('way too small')
                .max(100).message('way too big')

            Helper.validate(schema, [
                [1, false, 'way too small'],
                [1000, false, 'way too big']
            ])
        })

        it('overrides message with template', () => {

            const schema = Engine.number()
                .min(10).message(Engine.x('way too small'))

            Helper.validate(schema, [[1, false, 'way too small']])
        })

        it('overrides message in multiple language', () => {

            const messages = {
                english: {
                    root: 'value',
                    'number.min': '{#label} too small'
                },
                latin: {
                    root: 'valorem',
                    'number.min': Engine.x('{@label} angustus', { prefix: { local: '@' } })
                }
            }

            const schema = Engine.number().min(10).message(messages)

            expect(schema.validate(1, { errors: { language: 'english' } }).error).to.be.an.error('"value" too small')
            expect(schema.validate(1, { errors: { language: 'latin' } }).error).to.be.an.error('"valorem" angustus')
            expect(schema.validate(1, { errors: { language: 'unknown' } }).error).to.be.an.error('"value" must be greater than or equal to 10')
            expect(schema.label('special').validate(1, { errors: { language: 'english' } }).error).to.be.an.error('"special" too small')
        })

        it('overrides wildcard message in specific language', () => {

            const messages = {
                english: {
                    root: 'value',
                    'number.min': '{#label} too small',
                    '*': '{#label} is something else'
                }
            }

            const schema = Engine.number().min(10).max(11).messages(messages)

            expect(schema.validate(1, { errors: { language: 'english' } }).error).to.be.an.error('"value" too small')
            expect(schema.validate(12, { errors: { language: 'english' } }).error).to.be.an.error('"value" is something else')
        })

        it('overrides wildcard message', () => {

            const messages = {
                root: 'value',
                'number.min': '{#label} too small',
                '*': '{#label} is something else'
            }

            const schema = Engine.number().min(10).max(11).messages(messages)

            expect(schema.validate(1).error).to.be.an.error('"value" too small')
            expect(schema.validate(12).error).to.be.an.error('"value" is something else')
        })

        it('overrides message in multiple language (nested)', () => {

            const messages = {
                english: {
                    root: 'value',
                    'number.min': '{#label} too small'
                },
                latin: {
                    root: 'valorem',
                    'number.min': '{#label} angustus'
                }
            }

            const schema = Engine.object({ a: Engine.number().min(10).message(messages) })

            expect(schema.validate({ a: 1 }, { errors: { language: 'english' } }).error).to.be.an.error('"a" too small')
            expect(schema.validate({ a: 1 }, { errors: { language: 'latin' } }).error).to.be.an.error('"a" angustus')
            expect(schema.validate({ a: 1 }, { errors: { language: 'unknown' } }).error).to.be.an.error('"a" must be greater than or equal to 10')
        })

        it('overrides message in multiple language (flat)', () => {

            const messages = {
                root: 'valorem',
                'number.min': '{#label} angustus'
            }

            const schema = Engine.object({ a: Engine.number().min(10).message(messages) })
            Helper.validate(schema, [[{ a: 1 }, false, '"a" angustus']])
        })

        it('overrides message in multiple language (flat template)', () => {

            const messages = {
                root: 'valorem',
                'number.min': Engine.x('{@label} angustus', { prefix: { local: '@' } })
            }

            const schema = Engine.object({ a: Engine.number().min(10).message(messages) })
            Helper.validate(schema, [[{ a: 1 }, false, '"a" angustus']])
        })

        it('errors on invalid message value', () => {

            expect(() => Engine.number().min(10).message(12)).to.throw('Invalid message options')
            expect(() => Engine.number().min(10).message({ 'number.min': 12 })).to.throw('Invalid message for number.min')
            expect(() => Engine.number().min(10).message({ english: { 'number.min': 12 } })).to.throw('Invalid message for number.min in english')
        })
    })

    describe('meta()', () => {

        it('sets the meta', () => {

            const meta = { prop: 'val', prop2: 3 }
            let b = Engine.any().meta(meta)
            expect(b.describe().metas).to.equal([meta])

            b = b.meta({ other: true })
            expect(b.describe().metas).to.equal([meta, {
                other: true
            }])

        })

        it('throws when meta is missing', () => {

            expect(() => Engine.any().meta()).to.throw('Meta cannot be undefined')
        })
    })

    describe('not()', () => {

        it('validates invalid values', () => {

            Helper.validate(Engine.not(5), [
                [4, true],
                [5, false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: 5, invalids: [5], label: 'value' }
                }]
            ])
        })
    })

    describe('note()', () => {

        it('sets notes', () => {

            const b = Engine.any().note('a').note('my notes')
            expect(b.describe().notes).to.equal(['a', 'my notes'])
        })

        it('throws when notes are missing', () => {

            expect(() => Engine.any().note()).to.throw('Missing notes')
        })

        it('throws when notes are invalid', () => {

            expect(() => Engine.any().note(5)).to.throw('Notes must be non-empty strings')
            expect(() => Engine.any().note('')).to.throw('Notes must be non-empty strings')
        })
    })

    describe('only()', () => {

        it('allows only allowed values', () => {

            const schema = Engine.number().allow(1, 'x').only()

            Helper.validate(schema, [
                [1, true],
                ['x', true],
                [2, false, '"value" must be one of [1, x]']
            ])
        })
    })

    describe('optional()', () => {

        it('validates optional with default required', () => {

            const schema = Engine.object({
                a: Engine.any(),
                b: Engine.any(),
                c: {
                    d: Engine.any()
                }
            }).prefs({ presence: 'required' })

            Helper.validate(schema, [
                [{ a: 5 }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { label: 'b', key: 'b' }
                }],
                [{ a: 5, b: 6 }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { label: 'c', key: 'c' }
                }],
                [{ a: 5, b: 6, c: {} }, false, {
                    message: '"c.d" is required',
                    path: ['c', 'd'],
                    type: 'any.required',
                    context: { label: 'c.d', key: 'd' }
                }],
                [{ a: 5, b: 6, c: { d: 7 } }, true],
                [{}, false, {
                    message: '"a" is required',
                    path: ['a'],
                    type: 'any.required',
                    context: { label: 'a', key: 'a' }
                }],
                [{ b: 5 }, false, {
                    message: '"a" is required',
                    path: ['a'],
                    type: 'any.required',
                    context: { label: 'a', key: 'a' }
                }]
            ])
        })

        it('avoids unnecessary cloning when called twice', () => {

            const schema = Engine.any().optional()
            expect(schema.optional()).to.shallow.equal(schema)
        })
    })

    describe('options()', () => {

        it('does not modify provided options', () => {

            const options = { convert: true }
            const schema = Engine.object().prefs(options)
            schema.validate({})
            expect(options).to.equal({ convert: true })

            const options2 = { convert: false }
            schema.validate({}, options2)
            expect(options).to.equal({ convert: true })
            expect(options2).to.equal({ convert: false })
        })

        it('adds to existing options', () => {

            const schema = Engine.object({ b: Engine.number().strict().prefs({ convert: true }) })
            const input = { b: '2' }
            Helper.validate(schema, [[input, true, { b: 2 }]])
        })

        it('throws with an invalid option', () => {

            expect(() => Engine.any().prefs({ foo: 'bar' })).to.throw('"foo" is not allowed')
        })

        it('throws with an invalid option type', () => {

            expect(() => Engine.any().prefs({ convert: 'yes' })).to.throw('"convert" must be a boolean')
        })

        it('throws with an invalid option value', () => {

            expect(() => Engine.any().prefs({ presence: 'yes' })).to.throw('"presence" must be one of [required, optional, forbidden]')
        })

        it('does not throw with multiple options including presence key', () => {

            expect(() => Engine.any().prefs({ presence: 'optional', noDefaults: true })).to.not.throw()
        })

        it('describes a schema with options', () => {

            const schema = Engine.any().prefs({ abortEarly: false, convert: false })
            expect(schema.describe()).to.equal({ type: 'any', preferences: { abortEarly: false, convert: false } })
        })

        it('merges options properly', () => {

            const baseSchema = Engine.any()
            expect(baseSchema.describe().preferences).to.be.undefined()

            const languageSchema = baseSchema.prefs({ messages: { 'type.foo': 'foo' } })
            expect(languageSchema.describe().preferences).to.equal({ messages: { 'type.foo': 'foo' } })

            const normalOptionSchema = baseSchema.prefs({ abortEarly: true })
            expect(normalOptionSchema.describe().preferences).to.equal({ abortEarly: true })

            const normalOptionsOverLanguageSchema = languageSchema.prefs({ abortEarly: true })
            expect(normalOptionsOverLanguageSchema.describe().preferences).to.equal({
                abortEarly: true,
                messages: {
                    'type.foo': 'foo'
                }
            })

            const languageOptionsOverNormalOptionsSchema = normalOptionSchema.prefs({ messages: { 'type.foo': 'foo' } })
            expect(languageOptionsOverNormalOptionsSchema.describe().preferences).to.equal({
                abortEarly: true,
                messages: {
                    'type.foo': 'foo'
                }
            })

            const languageOptionsOverLanguageOptionsSchema = languageSchema.prefs({
                messages: {
                    'type.bar': 'bar',
                    'type2.foo': 'foo'
                }
            })
            expect(languageOptionsOverLanguageOptionsSchema.describe().preferences).to.equal({
                messages: {
                    'type.foo': 'foo',
                    'type.bar': 'bar',
                    'type2.foo': 'foo'
                }
            })
        })
    })

    describe('raw()', () => {

        it('gives the raw input', () => {

            const tests = [
                [Engine.binary(), 'abc'],
                [Engine.boolean(), false],
                [Engine.date(), '1970/01/01'],
                [Engine.number(), '12'],
                [Engine.any().strict(), 'abc']
            ]

            for (const test of tests) {
                const input = test[1]
                const schema = test[0].raw()
                Helper.validate(schema.raw(), [[input, true, input]])
            }
        })

        it('cancels raw mode', () => {

            const schema = Engine.number().raw().raw(false)
            Helper.validate(schema, [['123', true, 123]])
        })

        it('avoids unnecessary cloning when called twice', () => {

            const schema = Engine.any().raw()
            expect(schema.raw()).to.shallow.equal(schema)
        })
    })

    describe('required', () => {

        it('avoids unnecessary cloning when called twice', () => {

            const schema = Engine.any().required()
            expect(schema.required()).to.shallow.equal(schema)
        })
    })

    describe('rule()', () => {

        it('throws on empty ruleset', () => {

            expect(() => Engine.number().min(10).rule({})).to.not.throw()
            expect(() => Engine.number().ruleset.min(10).rule({})).to.not.throw()
            expect(() => Engine.number().$.min(10).rule({})).to.not.throw()
            expect(() => Engine.number().$.min(10).rule({}).max(11).rule({})).to.not.throw()
            expect(() => Engine.string().trim().min(1)._ruleRemove('trim').rule({})).to.not.throw()
            expect(() => Engine.string().trim().$.min(1)._ruleRemove('trim').rule({})).to.not.throw()

            expect(() => Engine.number().ruleset.min(10).concat(Engine.any())).to.throw('Cannot concatenate onto a schema with open ruleset')
            expect(() => Engine.number().concat(Engine.number().min(10)).rule({})).to.throw('Cannot apply rules to empty ruleset or the last rule added does not support rule properties')
            expect(() => Engine.number().concat(Engine.number().$.min(10))).to.throw('Cannot concatenate a schema with open ruleset')

            expect(() => Engine.any().ruleset.rule({})).to.throw('Cannot apply rules to empty ruleset')
            expect(() => Engine.any().rule({})).to.throw('Cannot apply rules to empty ruleset')
            expect(() => Engine.number().min(10).rule({}).rule({})).to.throw('Cannot apply rules to empty ruleset or the last rule added does not support rule properties')
            expect(() => Engine.string().ruleset.trim()._ruleRemove('trim').rule({})).to.throw('Cannot apply rules to empty ruleset')
            expect(() => Engine.string().trim()._ruleRemove('trim').rule({})).to.throw('Cannot apply rules to empty ruleset')

            expect(() => Engine.number().ruleset.min(10).concat(Engine.any().ruleset).rule({})).to.throw('Cannot concatenate onto a schema with open ruleset')
            expect(() => Engine.number().min(10).concat(Engine.number().$.max(11).rule({})).rule({})).to.throw('Cannot apply rules to empty ruleset or the last rule added does not support rule properties')

            expect(() => Engine.string().insensitive().rule({})).to.throw('Cannot apply rules to empty ruleset or the last rule added does not support rule properties')
            expect(() => Engine.string().lowercase().insensitive().rule({})).to.throw('Cannot apply rules to empty ruleset or the last rule added does not support rule properties')
            expect(() => Engine.string().$.lowercase().insensitive()).to.throw('Cannot set flag inside a ruleset')
        })

        describe('keep', () => {

            it('retains both unique rule instances', () => {

                const schema = Engine.number()
                    .min(10).rule({ message: 'way too small', keep: true })
                    .min(100).message('still too small')

                Helper.validate(schema, [
                    [1, false, 'way too small'],
                    [90, false, 'still too small']
                ])
            })
        })

        describe('message', () => {

            it('overrides message', () => {

                expect(Engine.number().min(10).rule({ message: 'way too small' }).validate(1).error).to.be.an.error('way too small')
                expect(Engine.number().min(10).rule({ message: { 'number.min': 'way too small' } }).validate(1).error).to.be.an.error('way too small')
                expect(Engine.number().min(10).rule({ message: { 'number.max': 'way too big' } }).validate(1).error).to.be.an.error('"value" must be greater than or equal to 10')
            })

            it('overrides ruleset with single message', () => {

                const schema = Engine.number().$.max(100).min(10).rule({ message: 'number out of bound' })
                Helper.validate(schema, [
                    [1, false, 'number out of bound'],
                    [101, false, 'number out of bound']
                ])
            })

            it('overrides ruleset messages', () => {

                const schema = Engine.number().$.max(100).min(10).rule({ message: { 'number.max': 'way too big', 'number.min': 'way too small' } })
                Helper.validate(schema, [
                    [1, false, 'way too small'],
                    [101, false, 'way too big']
                ])
            })

            it('overrides template', () => {

                expect(Engine.number().min(10).rule({ message: '{{#label}} way too small' }).validate(1).error).to.be.an.error('"value" way too small')
                expect(Engine.number().min(10).rule({ message: { 'number.min': '{{#label}} way too small' } }).validate(1).error).to.be.an.error('"value" way too small')
                expect(Engine.number().min(10).rule({ message: { 'number.max': '{{#label}} way too big' } }).validate(1).error).to.be.an.error('"value" must be greater than or equal to 10')
            })

            it('overrides ruleset with single template', () => {

                const schema = Engine.number().$.max(100).min(10).rule({ message: '{{#label}} number out of bound' })
                Helper.validate(schema, [
                    [1, false, '"value" number out of bound'],
                    [101, false, '"value" number out of bound']
                ])
            })

            it('overrides ruleset templates', () => {

                const schema = Engine.number().$.max(100).min(10).rule({ message: { 'number.max': '{{#label}} way too big', 'number.min': '{{#label}} way too small' } })
                Helper.validate(schema, [
                    [1, false, '"value" way too small'],
                    [101, false, '"value" way too big']
                ])
            })

            it('overrides ruleset with both message and template', () => {

                const schema = Engine.number().$.max(100).min(10).rule({ message: { 'number.max': 'way too big', 'number.min': '{{#label}} way too small' } })
                Helper.validate(schema, [
                    [1, false, '"value" way too small'],
                    [101, false, 'way too big']
                ])
            })
        })
    })

    describe('strict()', () => {

        it('validates without converting', () => {

            const schema = Engine.object({
                array: Engine.array().items(Engine.string().min(5), Engine.number().min(3))
            }).strict()

            Helper.validate(schema, [
                [{ array: ['12345'] }, true],
                [{ array: ['1'] }, false, {
                    message: '"array[0]" does not match any of the allowed types',
                    path: ['array', 0],
                    type: 'array.includes',
                    context: { pos: 0, value: '1', label: 'array[0]', key: 0 }
                }],
                [{ array: [3] }, true],
                [{ array: ['12345', 3] }, true],
                [{ array: ['3'] }, false, {
                    message: '"array[0]" does not match any of the allowed types',
                    path: ['array', 0],
                    type: 'array.includes',
                    context: { pos: 0, value: '3', label: 'array[0]', key: 0 }
                }],
                [{ array: [1] }, false, {
                    message: '"array[0]" does not match any of the allowed types',
                    path: ['array', 0],
                    type: 'array.includes',
                    context: { pos: 0, value: 1, label: 'array[0]', key: 0 }
                }]
            ])
        })

        it('can be disabled', () => {

            const schema = Engine.object({
                array: Engine.array().items(Engine.string().min(5), Engine.number().min(3))
            }).strict().strict(false)

            Helper.validate(schema, [
                [{ array: ['12345'] }, true],
                [{ array: ['1'] }, false, {
                    message: '"array[0]" does not match any of the allowed types',
                    path: ['array', 0],
                    type: 'array.includes',
                    context: { pos: 0, value: '1', label: 'array[0]', key: 0 }
                }],
                [{ array: [3] }, true],
                [{ array: ['12345', 3] }, true],
                [{ array: ['3'] }, true, { array: [3] }],
                [{ array: [1] }, false, {
                    message: '"array[0]" does not match any of the allowed types',
                    path: ['array', 0],
                    type: 'array.includes',
                    context: { pos: 0, value: 1, label: 'array[0]', key: 0 }
                }]
            ])
        })

        it('adds to existing options', () => {

            const schema = Engine.object({ b: Engine.number().prefs({ convert: true }).strict() })
            const input = { b: '2' }
            Helper.validate(schema, [[input, false, {
                message: '"b" must be a number',
                path: ['b'],
                type: 'number.base',
                context: { label: 'b', key: 'b', value: '2' }
            }]])
        })
    })

    describe('strip()', () => {

        it('validates and returns undefined', () => {

            const schema = Engine.string().strip()
            Helper.validate(schema, [['test', true, undefined]])
        })

        it('validates and returns an error', () => {

            const schema = Engine.string().strip()

            Helper.validate(schema, [[1, false, {
                message: '"value" must be a string',
                path: [],
                type: 'string.base',
                context: { value: 1, label: 'value' }
            }]])
        })

        it('avoids unnecessary cloning when called twice', () => {

            const schema = Engine.strip()
            expect(schema.strip()).to.shallow.equal(schema)
        })

        it('cancels strip', () => {

            const schema = Engine.strip().strip(false)
            expect(schema._flags.result).to.not.exist()
        })

        it('strips item inside array item', () => {

            const schema = Engine.array().items(
                Engine.array().items(
                    Engine.number(),
                    Engine.strip()
                ),
                Engine.strip()
            )

            Helper.validate(schema, [
                [['x', ['x']], true, [[]]],
                [[1, 2, [1, 2, 'x']], true, [[1, 2]]]
            ])
        })

        it('strips nested keys', () => {

            const schema = Engine.object({
                a: Engine.object({
                    x: Engine.any(),
                    y: Engine.strip()
                })
                    .strip(),

                b: Engine.ref('a.y')
            })

            Helper.validate(schema, [
                [{}, true, {}],
                [{ a: { x: 1 } }, true, {}],
                [{ a: { x: 1, y: 2 } }, true, {}],
                [{ a: { x: 1, y: 2 }, b: 2 }, true, { b: 2 }],
                [{ a: { x: 1, y: 2 }, b: 3 }, false, '"b" must be [ref:a.y]'],
                [{ b: 1 }, false, '"b" must be [ref:a.y]']
            ])
        })

        it('references validated stripped value (after child already stripped)', () => {

            const schema = Engine.object({
                a: Engine.object({
                    x: Engine.any(),
                    y: Engine.strip()
                })
                    .strip(),

                b: Engine.ref('a')
            })

            Helper.validate(schema, [
                [{}, true, {}],
                [{ a: { x: 1, y: 2 } }, true, {}],
                [{ a: { x: 1, y: 2 }, b: { x: 1 } }, true, { b: { x: 1 } }],
                [{ a: { x: 1, y: 2 }, b: { x: 1, y: 2 } }, false, '"b" must be [ref:a]']
            ])
        })

        it('strips key nested in alternative', () => {

            const schema = Engine.object({
                a: Engine.alternatives([
                    Engine.object({
                        x: Engine.number().strip(),
                        y: Engine.any()
                    }),
                    Engine.object({
                        x: Engine.any(),
                        z: Engine.any()
                    })
                ]),

                b: Engine.ref('a.x')
            })

            Helper.validate(schema, [
                [{}, true, {}],
                [{ a: { x: 1, y: 1 } }, true, { a: { y: 1 } }],
                [{ a: { x: 1, z: 1 } }, true],
                [{ a: { x: 1, z: 1 }, b: 1 }, true],
                [{ a: { x: 1, z: 1 }, b: 2 }, false, '"b" must be [ref:a.x]'],
                [{ a: { x: '2', z: 1 }, b: 2 }, false, '"b" must be [ref:a.x]'],
                [{ a: { x: '2', z: 1 }, b: '2' }, true]
            ])
        })

        it('strips key in array item', () => {

            const schema = Engine.array()
                .items(
                    Engine.object({
                        a: Engine.number().strip(),
                        b: Engine.ref('a')
                    }),
                    Engine.object({
                        a: Engine.string(),
                        b: Engine.ref('a')
                    })
                )

            Helper.validate(schema, [
                [[], true],
                [[{ a: 'x', b: 'x' }], true],
                [[{ a: 1, b: 1 }], true, [{ b: 1 }]],
                [[{ a: 'x', b: 'x' }, { a: 1, b: 1 }], true, [{ a: 'x', b: 'x' }, { b: 1 }]],
                [[{ a: '1', b: '1' }], true, [{ a: '1', b: '1' }]]
            ])
        })

        it('ignored in matches', () => {

            const schema = Engine.array()
                .items(Engine.object({
                    a: {
                        b: Engine.number().strip(),
                        c: Engine.number()
                    }
                }))
                .has(Engine.object({
                    a: {
                        b: Engine.number().min(10),
                        c: Engine.boolean().truthy(30).strip()         // Does not affect result
                    }
                }))

            Helper.validate(schema, [
                [[{ a: { b: '20', c: '30' } }], true, [{ a: { c: 30 } }]]
            ])
        })

        it('retains shadow after match', () => {

            const schema = Engine.object({
                a: Engine.number().strip()
            })
                .assert('.a', Engine.number().cast('string').strip().required(), 'error 1')
                .assert('.a', Engine.number().strict().required(), 'error 2')

            Helper.validate(schema, [
                [{ a: '1' }, true, {}]
            ])
        })

        it('revers match changes when shadow exists', () => {

            const schema = Engine.object({
                x: Engine.strip(),
                y: Engine.object({
                    z: Engine.when('$x', { otherwise: Engine.strip() })
                })
            })

            Helper.validate(schema, [
                [{ x: 1, y: { z: 'x' } }, true, { y: {} }]
            ])
        })
    })

    describe('tag()', () => {

        it('sets the tags', () => {

            const b = Engine.any().tag('tag1', 'tag2').tag('tag3')
            expect(b.describe().tags).to.include('tag1')
            expect(b.describe().tags).to.include('tag2')
            expect(b.describe().tags).to.include('tag3')
        })

        it('throws when tags are missing', () => {

            expect(() => Engine.any().tag()).to.throw('Missing tags')
        })

        it('throws when tags are invalid', () => {

            expect(() => Engine.any().tag(5)).to.throw('Tags must be non-empty strings')
            expect(() => Engine.any().tag('')).to.throw('Tags must be non-empty strings')
        })
    })

    describe('tailor()', () => {

        it('customizes root schema', () => {

            const alterations = {
                x: (s) => s.min(10),
                y: (s) => s.max(50),
                z: (s) => s.integer()
            }

            const before = Engine.number().alter(alterations)

            const first = before.tailor('x')
            const after1 = Engine.number().min(10).alter(alterations)

            Helper.equal(first, after1)
            expect(first.describe()).to.equal(after1.describe())

            const second = first.tailor(['y', 'z'])
            const after2 = Engine.number().min(10).max(50).integer().alter(alterations)

            Helper.equal(second, after2)
        })

        it('customizes root schema (multiple alter calls)', () => {

            const alter1 = {
                x: (s) => s.min(10)
            }

            const alter2 = {
                y: (s) => s.max(50),
                z: (s) => s.integer()
            }

            const before = Engine.number().alter(alter1).alter(alter2)

            const first = before.tailor('x')
            const after1 = Engine.number().min(10).alter(alter1).alter(alter2)

            Helper.equal(first, after1)
            expect(first.describe()).to.equal(after1.describe())

            const second = first.tailor(['y', 'z'])
            const after2 = Engine.number().min(10).max(50).integer().alter(alter1).alter(alter2)

            Helper.equal(second, after2)
        })

        it('customizes nested schema', () => {

            const alterations = {
                x: (s) => s.min(10),
                y: (s) => s.max(50)
            }

            const number = Engine.number().alter(alterations)

            const before = Engine.object({
                a: number,
                b: {
                    c: number
                },
                d: Engine.object()
                    .pattern(/.*/, number)
            })

            const tailored = before.tailor(['x', 'y'])

            const numberxy = number.min(10).max(50)
            const after = Engine.object({
                a: numberxy,
                b: {
                    c: numberxy
                },
                d: Engine.object()
                    .pattern(/.*/, numberxy)
            })

            Helper.equal(tailored, after)
            expect(tailored.describe()).to.equal(after.describe())
        })
    })

    describe('unit()', () => {

        it('sets the unit', () => {

            const b = Engine.any().unit('milliseconds')
            expect(b.describe().flags.unit).to.equal('milliseconds')
        })

        it('throws when unit is missing', () => {

            expect(() => Engine.any().unit()).to.throw('Unit name must be a non-empty string')
        })
    })

    describe('valid()', () => {

        it('allows valid values to be set', () => {

            expect(() => {

                Engine.any().valid(true, 1, 'hello', new Date(), Symbol('foo'), () => { }, {})
            }).not.to.throw()
        })

        it('throws when passed undefined', () => {

            expect(() => {

                Engine.any().valid(undefined)
            }).to.throw(Error, 'Cannot call allow/valid/invalid with undefined')
        })

        it('validates different types of values', () => {

            Helper.validate(Engine.valid(1), [[1, true]])
            Helper.validate(Engine.valid(1), [[2, false, '"value" must be [1]']])

            const d = new Date()
            Helper.validate(Engine.valid(d), [
                [new Date(d.getTime()), true],
                [new Date(d.getTime() + 1), false, {
                    message: `"value" must be [${d.toISOString()}]`,
                    path: [],
                    type: 'any.only',
                    context: { value: new Date(d.getTime() + 1), valids: [d], label: 'value' }
                }]
            ])
            Helper.validate(Engine.valid(Engine.ref('$a')), { context: { a: new Date(d.getTime()) } }, [[d, true]])
            Helper.validate(Engine.object({ a: Engine.date(), b: Engine.valid(Engine.ref('a')) }), [[{ a: d, b: d }, true]])
            Helper.validate(Engine.object({ a: Engine.array().items(Engine.date()).single(), b: Engine.valid(Engine.in('a')) }), [[{ a: [d], b: d }, true, { a: [d], b: d }]])
            Helper.validate(Engine.object({ a: Engine.array().items(Engine.date()).single(), b: Engine.valid(Engine.in('a')) }), [[{ a: [new Date(0)], b: d }, false, '"b" must be [ref:a]']])

            const str = 'foo'
            Helper.validate(Engine.valid(str), [
                [str, true],
                ['foobar', false, {
                    message: '"value" must be [foo]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'foobar', valids: [str], label: 'value' }
                }]
            ])

            const s = Symbol('foo')
            const otherSymbol = Symbol('foo')
            Helper.validate(Engine.valid(s), [
                [s, true],
                [otherSymbol, false, {
                    message: '"value" must be [Symbol(foo)]',
                    path: [],
                    type: 'any.only',
                    context: { value: otherSymbol, valids: [s], label: 'value' }
                }]
            ])

            const o = {}
            Helper.validate(Engine.valid(o), [
                [o, true],
                [{}, true],
                [{ x: 1 }, false, {
                    message: '"value" must be [[object Object]]',
                    path: [],
                    type: 'any.only',
                    context: { value: { x: 1 }, valids: [o], label: 'value' }
                }]
            ])

            const f = () => { }
            const otherFunction = () => { }
            Helper.validate(Engine.valid(f), [
                [f, true],
                [otherFunction, false, {
                    message: '"value" must be [() => { }]',
                    path: [],
                    type: 'any.only',
                    context: { value: otherFunction, valids: [f], label: 'value' }
                }]
            ])

            const b = Buffer.from('foo')
            Helper.validate(Engine.valid(b), [
                [b, true],
                [Buffer.from('foobar'), false, {
                    message: '"value" must be [foo]',
                    path: [],
                    type: 'any.only',
                    context: { value: Buffer.from('foobar'), valids: [b], label: 'value' }
                }]
            ])
        })

        it('supports templates', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.valid(Engine.x('{a + 1}'))
            })

            Helper.validate(schema, [
                [{ a: 5, b: 6 }, true],
                [{ a: 5, b: 5 }, false, '"b" must be [{a + 1}]']
            ])
        })

        it('supports templates with literals', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.valid(Engine.x('x{a + 1}'))
            })

            Helper.validate(schema, [
                [{ a: 5, b: 'x6' }, true],
                [{ a: 5, b: 'x5' }, false, '"b" must be [x{a + 1}]']
            ])
        })

        it('supports pure literal templates', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.valid(Engine.x('x'))
            })

            Helper.validate(schema, [
                [{ a: 5, b: 'x' }, true],
                [{ a: 5, b: 'y' }, false, '"b" must be [x]']
            ])
        })

        it('supports templates with functions', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.boolean(),
                c: Engine.valid(Engine.x('{if(a == 5 && b == true, a * 2, null)}'))
            })

            Helper.validate(schema, [
                [{ a: 5, b: true, c: 10 }, true],
                [{ a: 5, b: false, c: null }, true]
            ])
        })

        it('looks up values in array (from single value)', () => {

            const schema = Engine.object({
                a: Engine.array().items(Engine.string()),
                b: Engine.in('a')
            })

            Helper.validate(schema, [
                [{ a: ['1', '2'], b: '2' }, true],
                [{ a: ['1', '2'], b: '3' }, false, '"b" must be [ref:a]']
            ])
        })

        it('looks up values in array (from array value)', () => {

            const schema = Engine.object({
                a: Engine.array().items(Engine.string()),
                b: Engine.array().valid(Engine.ref('a'))
            })

            Helper.validate(schema, [
                [{ a: ['1', '2'], b: ['1', '2'] }, true],
                [{ a: ['1', '2'], b: ['1'] }, false, '"b" must be [ref:a]']
            ])
        })
    })

    describe('$_validate()', () => {

        it('checks value after conversion', () => {

            const schema = Engine.number().invalid(2)
            Helper.validate(schema, { abortEarly: false }, [['2', false, {
                message: '"value" contains an invalid value',
                details: [{
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: 2, invalids: [2], label: 'value' }
                }]
            }]])
        })
    })

    describe('validate()', () => {

        it('accepts only value (sync way)', () => {

            const schema = Engine.number()
            Helper.validate(schema, [['2', true, 2]])
        })

        it('accepts value and options', () => {

            const schema = Engine.number()
            Helper.validate(schema, { convert: false }, [['2', false, {
                message: '"value" must be a number',
                path: [],
                type: 'number.base',
                context: { label: 'value', value: '2' }
            }]])
        })

        it('accepts value, options and callback', () => {

            const schema = Engine.number()
            Helper.validate(schema, { convert: false }, [['2', false, {
                message: '"value" must be a number',
                path: [],
                type: 'number.base',
                context: { label: 'value', value: '2' }
            }]])
        })
    })

    describe('warn', () => {

        it('turns error into warning', () => {

            const schema = Engine.string().min(10).warn()
            const { value, error, warning } = schema.validate('abc')
            expect(value).to.equal('abc')
            expect(error).to.not.exist()
            expect(warning).to.equal({
                message: '"value" length must be at least 10 characters long',
                details: [
                    {
                        message: '"value" length must be at least 10 characters long',
                        path: [],
                        type: 'string.min',
                        context: {
                            encoding: undefined,
                            label: 'value',
                            limit: 10,
                            value: 'abc'
                        }
                    }
                ]
            })
        })
    })

    describe('when()', () => {

        it('throws when options are invalid', () => {

            expect(() => Engine.when('a', 4)).to.throw('Options must be of type object')
            expect(() => Engine.when('a')).to.throw('Missing options')
            expect(() => Engine.when(0)).to.throw('Missing options')
        })

        it('throws when break used with then and otherwise', () => {

            expect(() => Engine.when('a', { then: 1, otherwise: 2, break: true })).to.throw('Cannot specify then, otherwise, and break all together')
            expect(() => Engine.when('a', { switch: [{ is: true, then: 1, otherwise: 2 }], break: true })).to.throw('Cannot specify both otherwise and break')
        })

        it('validates multiple conditions', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.number()
                    .when('a', { is: true, then: Engine.number().max(100) })
                    .when('b', { is: true, then: Engine.number().min(10) })
            })

            Helper.validate(schema, [
                [{ c: 0 }, true],
                [{ c: 10 }, true],
                [{ c: 100 }, true],
                [{ c: 50 }, true],
                [{ c: 101 }, true],
                [{ a: true, c: 0 }, true],
                [{ a: true, c: 100 }, true],
                [{ a: true, c: 101 }, false, {
                    message: '"c" must be less than or equal to 100',
                    path: ['c'],
                    type: 'number.max',
                    context: { value: 101, label: 'c', key: 'c', limit: 100 }
                }],
                [{ b: true, c: 10 }, true],
                [{ b: true, c: 50 }, true],
                [{ b: true, c: 101 }, true],
                [{ b: true, c: 0 }, false, {
                    message: '"c" must be greater than or equal to 10',
                    path: ['c'],
                    type: 'number.min',
                    context: { value: 0, label: 'c', key: 'c', limit: 10 }
                }],
                [{ a: true, b: true, c: 10 }, true],
                [{ a: true, b: true, c: 100 }, true],
                [{ a: true, b: true, c: 50 }, true],
                [{ a: true, b: true, c: 0 }, false, {
                    message: '"c" must be greater than or equal to 10',
                    path: ['c'],
                    type: 'number.min',
                    context: { value: 0, label: 'c', key: 'c', limit: 10 }
                }],
                [{ a: true, b: true, c: 101 }, false, {
                    message: '"c" must be less than or equal to 100',
                    path: ['c'],
                    type: 'number.max',
                    context: { value: 101, label: 'c', key: 'c', limit: 100 }
                }]
            ])
        })

        it('validates multiple conditions (implicit valids)', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.number()
                    .when('a', { is: true, then: 1 })
                    .when('b', { is: true, then: 2 })
            })

            Helper.validate(schema, [
                [{ c: 0 }, true],
                [{ c: 1 }, true],
                [{ c: 2 }, true],
                [{ a: true, c: 1 }, true],
                [{ a: true, c: 2 }, false, {
                    message: '"c" must be [1]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 2, label: 'c', key: 'c', valids: [1] }
                }],
                [{ b: true, c: 2 }, true],
                [{ b: true, c: 1 }, false, {
                    message: '"c" must be [2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 1, label: 'c', key: 'c', valids: [2] }
                }],
                [{ a: true, b: true, c: 2 }, true],
                [{ a: true, b: true, c: 1 }, false, {
                    message: '"c" must be [2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 1, label: 'c', key: 'c', valids: [2] }
                }]
            ])
        })

        it('supports implicit this', () => {

            const schema = Engine.object({
                c: Engine.number()
                    .when({ is: 1, then: Engine.strip() })
            })

            Helper.validate(schema, [
                [{ c: 0 }, true],
                [{ c: 1 }, true, {}]
            ])
        })

        it('supports not', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.number()
                    .when('a', { not: false, then: 1 })
                    .when('b', { not: false, then: 2 })
            })

            Helper.validate(schema, [
                [{ c: 0 }, true],
                [{ c: 1 }, true],
                [{ c: 2 }, true],
                [{ a: true, c: 1 }, true],
                [{ a: true, c: 2 }, false, {
                    message: '"c" must be [1]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 2, label: 'c', key: 'c', valids: [1] }
                }],
                [{ b: true, c: 2 }, true],
                [{ b: true, c: 1 }, false, {
                    message: '"c" must be [2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 1, label: 'c', key: 'c', valids: [2] }
                }],
                [{ a: true, b: true, c: 2 }, true],
                [{ a: true, b: true, c: 1 }, false, {
                    message: '"c" must be [2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 1, label: 'c', key: 'c', valids: [2] }
                }]
            ])
        })

        it('defaults is to truthy', () => {

            const schema = Engine.object({
                a: Engine.any(),
                b: Engine.number()
                    .when('a', { then: 1, otherwise: 2 })
            })

            Helper.validate(schema, [
                [{ b: 2 }, true],
                [{ a: 1, b: 1 }, true],
                [{ b: 1 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 1, label: 'b', key: 'b', valids: [2] }
                }],
                [{ a: 0, b: 1 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 1, label: 'b', key: 'b', valids: [2] }
                }],
                [{ a: '', b: 1 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 1, label: 'b', key: 'b', valids: [2] }
                }],
                [{ a: false, b: 1 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 1, label: 'b', key: 'b', valids: [2] }
                }],
                [{ a: null, b: 1 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 1, label: 'b', key: 'b', valids: [2] }
                }]
            ])
        })

        it('sets type whens', () => {

            const schema = Engine.object({
                a: Engine.any(),
                b: Engine.string().valid('x').when('a', { is: 5, then: Engine.valid('y'), otherwise: Engine.valid('z') })
            })

            Helper.validate(schema, [
                [{ a: 5, b: 'x' }, true],
                [{ a: 5, b: 'y' }, true],
                [{ a: 5, b: 'z' }, false, {
                    message: '"b" must be one of [x, y]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'z', valids: ['x', 'y'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'x' }, true],
                [{ a: 1, b: 'y' }, false, {
                    message: '"b" must be one of [x, z]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'y', valids: ['x', 'z'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'z' }, true],
                [{ a: 5, b: 'a' }, false, {
                    message: '"b" must be one of [x, y]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x', 'y'], label: 'b', key: 'b' }
                }],
                [{ b: 'a' }, false, {
                    message: '"b" must be one of [x, z]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x', 'z'], label: 'b', key: 'b' }
                }]
            ])
        })

        it('sets type whens (only then)', () => {

            const schema = Engine.object({
                a: Engine.any(),
                b: Engine.string().valid('x').when('a', { is: 5, then: Engine.valid('y') })
            })

            Helper.validate(schema, [
                [{ a: 5, b: 'x' }, true],
                [{ a: 5, b: 'y' }, true],
                [{ a: 5, b: 'z' }, false, {
                    message: '"b" must be one of [x, y]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'z', valids: ['x', 'y'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'x' }, true],
                [{ a: 1, b: 'y' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'y', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'z' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'z', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ a: 5, b: 'a' }, false, {
                    message: '"b" must be one of [x, y]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x', 'y'], label: 'b', key: 'b' }
                }],
                [{ b: 'a' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x'], label: 'b', key: 'b' }
                }]
            ])
        })

        it('sets type whens (only otherwise)', () => {

            const schema = Engine.object({
                a: Engine.any(),
                b: Engine.string().valid('x').when('a', { is: 5, otherwise: Engine.valid('z') })
            })

            Helper.validate(schema, [
                [{ a: 5, b: 'x' }, true],
                [{ a: 5, b: 'y' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'y', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ a: 5, b: 'z' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'z', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'x' }, true],
                [{ a: 1, b: 'y' }, false, {
                    message: '"b" must be one of [x, z]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'y', valids: ['x', 'z'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'z' }, true],
                [{ a: 5, b: 'a' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ b: 'a' }, false, {
                    message: '"b" must be one of [x, z]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x', 'z'], label: 'b', key: 'b' }
                }]
            ])
        })

        it('sets type whens (with is as a schema)', () => {

            const schema = Engine.object({
                a: Engine.any(),
                b: Engine.string().valid('x').when('a', { is: Engine.number().valid(5).required(), then: Engine.valid('y') })
            })

            Helper.validate(schema, [
                [{ a: 5, b: 'x' }, true],
                [{ a: 5, b: 'y' }, true],
                [{ a: 5, b: 'z' }, false, {
                    message: '"b" must be one of [x, y]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'z', valids: ['x', 'y'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'x' }, true],
                [{ a: 1, b: 'y' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'y', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 'z' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'z', valids: ['x'], label: 'b', key: 'b' }
                }],
                [{ a: 5, b: 'a' }, false, {
                    message: '"b" must be one of [x, y]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x', 'y'], label: 'b', key: 'b' }
                }],
                [{ b: 'a' }, false, {
                    message: '"b" must be [x]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 'a', valids: ['x'], label: 'b', key: 'b' }
                }]
            ])
        })

        it('makes peer required', () => {

            const schema = Engine.object({
                a: Engine.when('b', { is: 5, then: Engine.required() }),
                b: Engine.any()
            })

            Helper.validate(schema, [
                [{ b: 5 }, false, {
                    message: '"a" is required',
                    path: ['a'],
                    type: 'any.required',
                    context: { label: 'a', key: 'a' }
                }],
                [{ b: 6 }, true],
                [{ a: 'b' }, true],
                [{ b: 5, a: 'x' }, true]
            ])
        })

        it('makes peer required (is ref)', () => {

            const schema = Engine.object({
                a: Engine.when('b', { is: Engine.ref('c'), then: Engine.required() }),
                b: Engine.any(),
                c: Engine.any()
            })

            Helper.validate(schema, [
                [{ b: 5, c: 5 }, false, {
                    message: '"a" is required',
                    path: ['a'],
                    type: 'any.required',
                    context: { label: 'a', key: 'a' }
                }],
                [{ b: 6, c: 5 }, true],
                [{ a: 'b' }, true],
                [{ b: 5, a: 'x' }, true]
            ])
        })

        it('makes peer required (switch is ref)', () => {

            const schema = Engine.object({
                a: Engine.when('b', [
                    { is: Engine.ref('c'), then: Engine.required() },
                    { is: 10, then: Engine.forbidden() }
                ]),
                b: Engine.any(),
                c: Engine.any()
            })

            Helper.validate(schema, [
                [{ b: 5, c: 5 }, false, {
                    message: '"a" is required',
                    path: ['a'],
                    type: 'any.required',
                    context: { label: 'a', key: 'a' }
                }],
                [{ b: 6, c: 5 }, true],
                [{ a: 'b' }, true],
                [{ b: 5, a: 'x' }, true]
            ])
        })

        it('breaks early', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.number()
                    .when('d', { then: 0, break: true })
                    .when('a', { then: 1, break: true })
                    .when('b', { then: 2 })
            })

            Helper.validate(schema, [
                [{ a: true, b: true, c: 1 }, true],
                [{ a: false, b: true, c: 2 }, true],
                [{ a: false, b: true, c: 1 }, false, {
                    message: '"c" must be [2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 1, label: 'c', key: 'c', valids: [2] }
                }]
            ])
        })

        it('breaks early (otherwise)', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.number()
                    .when('a', { otherwise: 2, break: true })
                    .when('b', { then: 1 })
            })

            Helper.validate(schema, [
                [{ a: true, b: true, c: 1 }, true],
                [{ a: false, b: true, c: 2 }, true],
                [{ a: false, b: true, c: 1 }, false, {
                    message: '"c" must be [2]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 1, label: 'c', key: 'c', valids: [2] }
                }]
            ])
        })

        it('works with prefs()', () => {

            const schema = Engine.number()
                .prefs({ errors: { label: 'key' } })
                .when('$x', { then: Engine.number().min(1) })

            Helper.validate(schema, { context: { x: true } }, [
                [1, true],
                [0, false, '"value" must be greater than or equal to 1']
            ])
        })

        it('describes the base schema', () => {

            const schema = Engine.number()
                .min(10)
                .when('a', {
                    is: 5,
                    then: Engine.number().max(20).required()
                })

            expect(schema.describe()).to.equal({
                type: 'number',
                rules: [
                    { args: { limit: 10 }, name: 'min' }
                ],
                whens: [{
                    ref: { path: ['a'] },
                    is: {
                        type: 'any',
                        flags: {
                            only: true,
                            presence: 'required'
                        },
                        allow: [{ override: true }, 5]
                    },
                    then: {
                        type: 'number',
                        flags: {
                            presence: 'required'
                        },
                        rules: [{ name: 'max', args: { limit: 20 } }]
                    }
                }]
            })
        })

        it('can describe as the original object (with a schema as a condition)', () => {

            const schema = Engine.number()
                .min(10)
                .when(Engine.number().min(5), { then: Engine.number().max(20).required() })

            expect(schema.describe()).to.equal({
                type: 'number',
                rules: [{ args: { limit: 10 }, name: 'min' }],
                whens: [{
                    is: {
                        type: 'number',
                        rules: [{ name: 'min', args: { limit: 5 } }]
                    },
                    then: {
                        type: 'number',
                        flags: { presence: 'required' },
                        rules: [{ name: 'max', args: { limit: 20 } }]
                    }
                }]
            })
        })

        it('sets value based on multiple conditions', () => {

            const schema = Engine.object({
                a: Engine.number().required(),
                b: Engine.number()
                    .when('a', [
                        { is: 0, then: Engine.valid(1) },
                        { is: 1, then: Engine.valid(2) },
                        { is: 2, then: Engine.valid(3) }
                    ])
            })

            Helper.validate(schema, [
                [{ a: 0, b: 1 }, true],
                [{ a: 0, b: 2 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 2 }, true],
                [{ a: 1, b: 3 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 3, valids: [2], label: 'b', key: 'b' }
                }],
                [{ a: 2, b: 3 }, true],
                [{ a: 2, b: 4 }, false, {
                    message: '"b" must be [3]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 4, valids: [3], label: 'b', key: 'b' }
                }],
                [{ a: 42, b: 128 }, true]
            ])
        })

        it('sets value based on multiple conditions with otherwise', () => {

            const schema = Engine.object({
                a: Engine.number().required(),
                b: Engine.number()
                    .when('a', {
                        switch: [
                            { is: 0, then: Engine.valid(1) },
                            { is: 1, then: Engine.valid(2) },
                            { is: 2, then: Engine.valid(3) }
                        ],
                        otherwise: Engine.valid(4)
                    })
            })

            Helper.validate(schema, [
                [{ a: 0, b: 1 }, true],
                [{ a: 0, b: 2 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 2 }, true],
                [{ a: 1, b: 3 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 3, valids: [2], label: 'b', key: 'b' }
                }],
                [{ a: 2, b: 3 }, true],
                [{ a: 2, b: 2 }, false, {
                    message: '"b" must be [3]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [3], label: 'b', key: 'b' }
                }],
                [{ a: 42, b: 4 }, true],
                [{ a: 42, b: 128 }, false, {
                    message: '"b" must be [4]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 128, valids: [4], label: 'b', key: 'b' }
                }]
            ])
        })

        it('sets value based on multiple conditions with otherwise (short)', () => {

            const schema = Engine.object({
                a: Engine.number().required(),
                b: Engine.number()
                    .when('a', [
                        { is: 0, then: 1 },
                        { is: 1, then: 2 },
                        { is: 2, then: 3, otherwise: 4 }
                    ])
            })

            Helper.validate(schema, [
                [{ a: 0, b: 1 }, true],
                [{ a: 0, b: 2 }, false, {
                    message: '"b" must be [1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [1], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 2 }, true],
                [{ a: 1, b: 3 }, false, {
                    message: '"b" must be [2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 3, valids: [2], label: 'b', key: 'b' }
                }],
                [{ a: 2, b: 3 }, true],
                [{ a: 2, b: 2 }, false, {
                    message: '"b" must be [3]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [3], label: 'b', key: 'b' }
                }],
                [{ a: 42, b: 4 }, true],
                [{ a: 42, b: 128 }, false, {
                    message: '"b" must be [4]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 128, valids: [4], label: 'b', key: 'b' }
                }]
            ])
        })

        it('sets value based on multiple conditions (with base rules)', () => {

            const schema = Engine.object({
                a: Engine.number().required(),
                b: Engine.number().valid(10)
                    .when('a', [
                        { is: 0, then: Engine.valid(1) },
                        { is: 1, then: Engine.valid(2) },
                        { is: 2, then: Engine.valid(3) }
                    ])
            })

            Helper.validate(schema, [
                [{ a: 0, b: 1 }, true],
                [{ a: 0, b: 2 }, false, {
                    message: '"b" must be one of [10, 1]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 2, valids: [10, 1], label: 'b', key: 'b' }
                }],
                [{ a: 0, b: 10 }, true],
                [{ a: 1, b: 2 }, true],
                [{ a: 1, b: 3 }, false, {
                    message: '"b" must be one of [10, 2]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 3, valids: [10, 2], label: 'b', key: 'b' }
                }],
                [{ a: 1, b: 10 }, true],
                [{ a: 2, b: 3 }, true],
                [{ a: 2, b: 4 }, false, {
                    message: '"b" must be one of [10, 3]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 4, valids: [10, 3], label: 'b', key: 'b' }
                }],
                [{ a: 2, b: 10 }, true],
                [{ a: 42, b: 128 }, false, {
                    message: '"b" must be [10]',
                    path: ['b'],
                    type: 'any.only',
                    context: { value: 128, valids: [10], label: 'b', key: 'b' }
                }],
                [{ a: 42, b: 10 }, true]
            ])
        })

        it('caches partials using variations in sub when conditions', () => {

            const sub = Engine.when('b', { is: true, then: 2, otherwise: 3 })
            const schema = Engine.object({
                a: Engine.boolean().required(),
                b: Engine.boolean().required(),
                c: Engine.number()
                    .when('a', { is: true, then: 1, otherwise: sub })
            })

            Helper.validate(schema, [
                [{ a: true, b: true, c: 1 }, true],
                [{ a: false, b: true, c: 2 }, true],
                [{ a: false, b: false, c: 3 }, true]
            ])
        })

        it('validates conditional whens (self reference, explicit)', () => {

            const schema = Engine.object({
                a: Engine.boolean().required()
            })
                .when(Engine.ref('a', { ancestor: 0 }), {
                    is: true,
                    then: {
                        b: Engine.string().required()
                    },
                    otherwise: {
                        c: Engine.string().required()
                    }
                })

            Helper.validate(schema, [
                [{ a: true, b: 'x' }, true],
                [{ a: true, b: 5 }, false, {
                    message: '"b" must be a string',
                    path: ['b'],
                    type: 'string.base',
                    context: { value: 5, key: 'b', label: 'b' }
                }],
                [{ a: true }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { key: 'b', label: 'b' }
                }],
                [{ a: true, c: 5 }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { key: 'b', label: 'b' }
                }],
                [{ a: true, c: 'x' }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { key: 'b', label: 'b' }
                }],

                [{ a: false, b: 'x' }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { key: 'c', label: 'c' }
                }],
                [{ a: false, b: 5 }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { key: 'c', label: 'c' }
                }],
                [{ a: false }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { key: 'c', label: 'c' }
                }],
                [{ a: false, c: 5 }, false, {
                    message: '"c" must be a string',
                    path: ['c'],
                    type: 'string.base',
                    context: { value: 5, key: 'c', label: 'c' }
                }],
                [{ a: false, c: 'x' }, true]
            ])
        })

        it('validates conditional whens (self reference, implicit)', () => {

            const schema = Engine.object({
                a: Engine.boolean().required()
            })
                .when('.a', {
                    is: true,
                    then: {
                        b: Engine.string().required()
                    },
                    otherwise: {
                        c: Engine.string().required()
                    }
                })

            Helper.validate(schema, [
                [{ a: true, b: 'x' }, true],
                [{ a: true, b: 5 }, false, {
                    message: '"b" must be a string',
                    path: ['b'],
                    type: 'string.base',
                    context: { value: 5, key: 'b', label: 'b' }
                }],
                [{ a: true }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { key: 'b', label: 'b' }
                }],
                [{ a: true, c: 5 }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { key: 'b', label: 'b' }
                }],
                [{ a: true, c: 'x' }, false, {
                    message: '"b" is required',
                    path: ['b'],
                    type: 'any.required',
                    context: { key: 'b', label: 'b' }
                }],
                [{ a: false, b: 'x' }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { key: 'c', label: 'c' }
                }],
                [{ a: false, b: 5 }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { key: 'c', label: 'c' }
                }],
                [{ a: false }, false, {
                    message: '"c" is required',
                    path: ['c'],
                    type: 'any.required',
                    context: { key: 'c', label: 'c' }
                }],
                [{ a: false, c: 5 }, false, {
                    message: '"c" must be a string',
                    path: ['c'],
                    type: 'string.base',
                    context: { value: 5, key: 'c', label: 'c' }
                }],
                [{ a: false, c: 'x' }, true]
            ])
        })

        it('validates with nested whens', () => {

            // If ((b === 0 && a === 123) ||
            //     (b !== 0 && a === anything))
            // then c === 456
            // else c === 789

            const schema = Engine.object({
                a: Engine.number().required(),
                b: Engine.number().required(),
                c: Engine.when('a', {
                    is: Engine.when('b', {
                        is: Engine.valid(0),
                        then: Engine.valid(123)
                    }),
                    then: Engine.valid(456),
                    otherwise: Engine.valid(789)
                })
            })

            Helper.validate(schema, [
                [{ a: 123, b: 0, c: 456 }, true],
                [{ a: 0, b: 1, c: 456 }, true],
                [{ a: 0, b: 0, c: 789 }, true],
                [{ a: 123, b: 456, c: 456 }, true],
                [{ a: 0, b: 0, c: 456 }, false, {
                    message: '"c" must be [789]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 456, valids: [789], label: 'c', key: 'c' }
                }],
                [{ a: 123, b: 456, c: 789 }, false, {
                    message: '"c" must be [456]',
                    path: ['c'],
                    type: 'any.only',
                    context: { value: 789, valids: [456], label: 'c', key: 'c' }
                }]
            ])
        })

        it('throws when conditions conflict', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.when('a', { is: true, then: Engine.number() }).when('b', { is: true, then: Engine.string() })
            })

            expect(() => schema.validate({ a: true, b: true, c: 'x' })).to.throw('Cannot merge type number with another type: string')
        })

        describe('with schema', () => {

            it('should peek inside a simple value', () => {

                const schema = Engine.number().when(Engine.number().min(0), { then: Engine.number().min(10) })
                Helper.validate(schema, [
                    [-1, true, -1],
                    [1, false, {
                        message: '"value" must be greater than or equal to 10',
                        path: [],
                        type: 'number.min',
                        context: { limit: 10, value: 1, label: 'value' }
                    }],
                    [10, true, 10]
                ])
            })

            it('should peek inside an object', () => {

                const schema = Engine.object().keys({
                    foo: Engine.string(),
                    bar: Engine.number()
                })
                    .when(Engine.object().keys({ foo: Engine.valid('hasBar').required() }).unknown(), {
                        then: Engine.object().keys({ bar: Engine.required() })
                    })

                Helper.validate(schema, [
                    [{ foo: 'whatever' }, true, { foo: 'whatever' }],
                    [{ foo: 'hasBar' }, false, {
                        message: '"bar" is required',
                        path: ['bar'],
                        type: 'any.required',
                        context: { key: 'bar', label: 'bar' }
                    }],
                    [{ foo: 'hasBar', bar: 42 }, true, { foo: 'hasBar', bar: 42 }],
                    [{}, true, {}]
                ])
            })
        })
    })

    describe('_rule()', () => {

        it('errors on invalid options', () => {

            expect(() => Engine.any().$_addRule()).to.throw('Invalid options')
            expect(() => Engine.any().$_addRule(5)).to.throw('Invalid options')
            expect(() => Engine.any().$_addRule({})).to.throw('Invalid rule name')
            expect(() => Engine.any().$_addRule('')).to.throw('Invalid rule name')
            expect(() => Engine.any().$_addRule({ name: '' })).to.throw('Invalid rule name')
            expect(() => Engine.any().$_addRule({ name: 5 })).to.throw('Invalid rule name')
        })
    })

    describe('~standard', () => {

        it('returns the version number of the standard', () => {

            const schema = Engine.number()
            expect(schema['~standard'].version).to.equal(1)
        })

        it('returns the vendor name of the schema library', () => {

            const schema = Engine.number()
            //lakutata: the vendor of the engine is lakutata (upstream: its own name)
            expect(schema['~standard'].vendor).to.equal('lakutata')
        })

        describe('validate', () => {

            it('return only value when passing', () => {

                const schema = Engine.string()
                expect(schema['~standard'].validate('3')).to.equal({
                    value: '3'
                })
            })

            it('return only issues when not passing', () => {

                const schema = Engine.string()
                expect(schema['~standard'].validate(3)).to.equal({
                    issues: [{ message: '"value" must be a string', path: [] }]
                })
            })

            it('return only issues when not passing (custom error is Error)', () => {

                const schema = Engine.string().error(new Error('Was REALLY expecting a string'))
                expect(schema['~standard'].validate(3)).to.equal({
                    issues: [{ message: 'Was REALLY expecting a string' }]
                })
            })

            it('return only issues when not passing (custom error is validation error function that return string)', () => {

                const schema = Engine.object({
                    foo: Engine.number().min(0).error((errors) => new Error('"foo" requires a positive number'))
                })
                expect(schema['~standard'].validate({ foo: -2 })).to.equal({
                    issues: [{ message: '"foo" requires a positive number' }]
                })
            })
        })
    })
})
