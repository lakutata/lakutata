/**
 * Ported from the upstream test/index.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Util from 'node:util'
import * as Utils from '../../../lib/validation/engine/utils/index.js'
const internals = {}

const nestedObj = {
    v: [7, 8, 9],
    w: /^something$/igm,
    x: {
        a: [1, 2, 3],
        b: 123456,
        c: new Date(),
        d: /hi/igm,
        e: /hello/
    },
    y: 'y',
    z: new Date(1378775452757)
}

describe('merge()', () => {

    it('deep copies source items', () => {

        const sym1 = Symbol('1')
        const sym2 = Symbol('2')
        const sym3 = Symbol('3')

        const target = {
            b: 3,
            d: [],
            [sym1]: true,
            [sym3]: true
        }

        const source = {
            c: {
                d: 1
            },
            d: [{ e: 1 }],
            [sym2]: true,
            [sym3]: false
        }

        Utils.merge(target, source)
        expect(target.c).to.not.shallow.equal(source.c)
        expect(target.c).to.equal(source.c)
        expect(target.d).to.not.shallow.equal(source.d)
        expect(target.d[0]).to.not.shallow.equal(source.d[0])
        expect(target.d).to.equal(source.d)

        expect(target[sym1]).to.be.true()
        expect(target[sym2]).to.be.true()
        expect(target[sym3]).to.be.false()
    })

    it('deep copies source items without symbols', () => {

        const sym1 = Symbol('1')
        const sym2 = Symbol('2')
        const sym3 = Symbol('3')

        const target = {
            b: 3,
            d: [],
            [sym1]: true,
            [sym3]: true
        }

        const source = {
            c: {
                d: 1
            },
            d: [{ e: 1 }],
            [sym2]: true,
            [sym3]: false
        }

        Utils.merge(target, source, { symbols: false })
        expect(target.c).to.not.shallow.equal(source.c)
        expect(target.c).to.equal(source.c)
        expect(target.d).to.not.shallow.equal(source.d)
        expect(target.d[0]).to.not.shallow.equal(source.d[0])
        expect(target.d).to.equal(source.d)

        expect(target[sym1]).to.be.true()
        expect(target[sym2]).to.not.exist()
        expect(target[sym3]).to.be.true()
    })

    it('merges array over an object', () => {

        const a = {
            x: ['n', 'm']
        }

        const b = {
            x: {
                n: '1',
                m: '2'
            }
        }

        Utils.merge(b, a)
        expect(a.x[0]).to.equal('n')
        expect(a.x.n).to.not.exist()
    })

    it('merges object over an array', () => {

        const a = {
            x: ['n', 'm']
        }

        const b = {
            x: {
                n: '1',
                m: '2'
            }
        }

        Utils.merge(a, b)
        expect(a.x.n).to.equal('1')
        expect(a.x[0]).to.not.exist()
    })

    it('merges from null prototype objects', () => {

        const a = {}

        const b = Object.create(null)
        b.x = true

        Utils.merge(a, b)
        expect(a.x).to.be.true()
    })

    it('skips non-enumerable properties', () => {

        const a = { x: 0 }

        const b = {}
        Object.defineProperty(b, 'x', {
            enumerable: false,
            value: 1
        })

        Utils.merge(a, b)
        expect(a.x).to.equal(0)
    })

    it('does not throw if source is null', () => {

        const a = {}
        const b = null
        let c = null

        expect(() => {

            c = Utils.merge(a, b)
        }).to.not.throw()

        expect(c).to.equal(a)
    })

    it('does not throw if source is undefined', () => {

        const a = {}
        const b = undefined
        let c = null

        expect(() => {

            c = Utils.merge(a, b)
        }).to.not.throw()

        expect(c).to.equal(a)
    })

    it('throws if source is not an object', () => {

        expect(() => {

            const a = {}
            const b = 0

            Utils.merge(a, b)
        }).to.throw('Invalid source value: must be null, undefined, or an object')
    })

    it('throws if target is not an object', () => {

        expect(() => {

            const a = 0
            const b = {}

            Utils.merge(a, b)
        }).to.throw('Invalid target value: must be an object')
    })

    it('throws if target is not an array and source is', () => {

        expect(() => {

            const a = {}
            const b = [1, 2]

            Utils.merge(a, b)
        }).to.throw('Cannot merge array onto an object')
    })

    it('returns the same object when merging arrays', () => {

        const a = []
        const b = [1, 2]

        expect(Utils.merge(a, b)).to.equal(a)
    })

    it('combines an empty object with a non-empty object', () => {

        const a = {}
        const b = nestedObj

        const c = Utils.merge(a, b)
        expect(a).to.equal(b)
        expect(c).to.equal(b)
    })

    it('overrides values in target', () => {

        const a = { x: 1, y: 2, z: 3, v: 5, t: 'test', s: 1, m: 'abc' }
        const b = { x: null, z: 4, v: 0, t: { u: 6 }, s: undefined, m: '123' }

        const c = Utils.merge(a, b)
        expect(c.x).to.equal(null)
        expect(c.y).to.equal(2)
        expect(c.z).to.equal(4)
        expect(c.v).to.equal(0)
        expect(c.m).to.equal('123')
        expect(c.t).to.equal({ u: 6 })
        expect(c.s).to.equal(undefined)
    })

    it('overrides values in target (flip)', () => {

        const a = { x: 1, y: 2, z: 3, v: 5, t: 'test', s: 1, m: 'abc' }
        const b = { x: null, z: 4, v: 0, t: { u: 6 }, s: undefined, m: '123' }

        const d = Utils.merge(b, a)
        expect(d.x).to.equal(1)
        expect(d.y).to.equal(2)
        expect(d.z).to.equal(3)
        expect(d.v).to.equal(5)
        expect(d.m).to.equal('abc')
        expect(d.t).to.equal('test')
        expect(d.s).to.equal(1)
    })

    it('retains Date properties', () => {

        const a = { x: new Date(1378776452757) }

        const b = Utils.merge({}, a)
        expect(a.x.getTime()).to.equal(b.x.getTime())
    })

    it('retains Date properties when merging keys', () => {

        const a = { x: new Date(1378776452757) }

        const b = Utils.merge({ x: {} }, a)
        expect(a.x.getTime()).to.equal(b.x.getTime())
    })

    it('overrides Buffer', () => {

        const a = { x: Buffer.from('abc') }

        Utils.merge({ x: {} }, a)
        expect(a.x.toString()).to.equal('abc')
    })

    it('overrides RegExp', () => {

        const a = { x: /test/ }

        Utils.merge({ x: {} }, a)
        expect(a.x).to.equal(/test/)
    })

    it('overrides Symbol properties', () => {

        const sym = Symbol()
        const a = { [sym]: 1 }

        Utils.merge({ [sym]: {} }, a)
        expect(a[sym]).to.equal(1)
    })

    it('skips __proto__', () => {

        const a = '{ "ok": "value", "__proto__": { "test": "value" } }'

        const b = Utils.merge({}, JSON.parse(a))
        expect(b).to.equal({ ok: 'value' })
        expect(b.test).to.equal(undefined)
    })
})

describe('applyToDefaults()', () => {

    it('throws when target is null', () => {

        expect(() => {

            Utils.applyToDefaults(null, {})
        }).to.throw('Invalid defaults value: must be an object')
    })

    it('throws when options are invalid', () => {

        expect(() => {

            Utils.applyToDefaults({}, {}, false)
        }).to.throw('Invalid options: must be an object')

        expect(() => {

            Utils.applyToDefaults({}, {}, 123)
        }).to.throw('Invalid options: must be an object')
    })

    it('returns null if source is false', () => {

        const defaults = {
            a: 1,
            b: 2,
            c: {
                d: 3,
                e: [5, 6]
            },
            f: 6,
            g: 'test'
        }

        const result = Utils.applyToDefaults(defaults, false)
        expect(result).to.equal(null)
    })

    it('returns null if source is null', () => {

        const defaults = {
            a: 1,
            b: 2,
            c: {
                d: 3,
                e: [5, 6]
            },
            f: 6,
            g: 'test'
        }

        const result = Utils.applyToDefaults(defaults, null)
        expect(result).to.equal(null)
    })

    it('returns null if source is undefined', () => {

        const defaults = {
            a: 1,
            b: 2,
            c: {
                d: 3,
                e: [5, 6]
            },
            f: 6,
            g: 'test'
        }

        const result = Utils.applyToDefaults(defaults, undefined)
        expect(result).to.equal(null)
    })

    it('returns a copy of defaults if source is true', () => {

        const defaults = {
            a: 1,
            b: 2,
            c: {
                d: 3,
                e: [5, 6]
            },
            f: 6,
            g: 'test'
        }

        const result = Utils.applyToDefaults(defaults, true)
        expect(result).to.equal(defaults)
    })

    it('applies object to defaults', () => {

        const defaults = {
            a: 1,
            b: 2,
            c: {
                d: 3,
                e: [5, 6]
            },
            f: 6,
            g: 'test'
        }

        const obj = {
            a: null,
            c: {
                e: [4]
            },
            f: 0,
            g: {
                h: 5
            }
        }

        const result = Utils.applyToDefaults(defaults, obj)
        expect(result.c.e).to.equal([4])
        expect(result.a).to.equal(1)
        expect(result.b).to.equal(2)
        expect(result.f).to.equal(0)
        expect(result.g).to.equal({ h: 5 })
    })

    it('applies object to defaults with null', () => {

        const defaults = {
            a: 1,
            b: 2,
            c: {
                d: 3,
                e: [5, 6]
            },
            f: 6,
            g: 'test'
        }

        const obj = {
            a: null,
            c: {
                e: [4]
            },
            f: 0,
            g: {
                h: 5
            }
        }

        const result = Utils.applyToDefaults(defaults, obj, { nullOverride: true })
        expect(result.c.e).to.equal([4])
        expect(result.a).to.equal(null)
        expect(result.b).to.equal(2)
        expect(result.f).to.equal(0)
        expect(result.g).to.equal({ h: 5 })
    })

    it('shallow copies the listed keys from source without merging', () => {

        const defaults = {
            a: {
                b: 5,
                e: 3
            },
            c: {
                d: 7,
                g: 1
            }
        }

        const source = {
            a: {
                b: 4
            },
            c: {
                d: 6,
                f: 7
            }
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['a'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { d: 6, g: 1, f: 7 } })
        expect(merged.a).to.shallow.equal(source.a)
        expect(merged.a).to.not.equal(defaults.a)
        expect(merged.c).to.not.equal(source.c)
        expect(merged.c).to.not.equal(defaults.c)
    })

    it('shallow copies the nested keys (override)', () => {

        const defaults = {
            a: {
                b: 5
            },
            c: {
                d: 7,
                g: 1
            }
        }

        const source = {
            a: {
                b: 4
            },
            c: {
                d: 6,
                g: {
                    h: 8
                }
            }
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['c.g'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { d: 6, g: { h: 8 } } })
        expect(merged.c.g).to.shallow.equal(source.c.g)
    })

    it('shallow copies the nested keys (missing)', () => {

        const defaults = {
            a: {
                b: 5
            }
        }

        const source = {
            a: {
                b: 4
            },
            c: {
                g: {
                    h: 8
                }
            }
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['c.g'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { g: { h: 8 } } })
        expect(merged.c.g).to.shallow.equal(source.c.g)
    })

    it('shallow copies the nested keys (override)', () => {

        const defaults = {
            a: {
                b: 5
            },
            c: {
                g: {
                    d: 7
                }
            }
        }

        const source = {
            a: {
                b: 4
            },
            c: {
                g: {
                    h: 8
                }
            }
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['c.g'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { g: { h: 8 } } })
        expect(merged.c.g).to.shallow.equal(source.c.g)
    })

    it('shallow copies the nested keys (deeper)', () => {

        const defaults = {
            a: {
                b: 5
            }
        }

        const source = {
            a: {
                b: 4
            },
            c: {
                g: {
                    r: {
                        h: 8
                    }
                }
            }
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['c.g.r'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { g: { r: { h: 8 } } } })
        expect(merged.c.g.r).to.shallow.equal(source.c.g.r)
    })

    it('shallow copies the nested keys (not present)', () => {

        const defaults = {
            a: {
                b: 5
            }
        }

        const source = {
            a: {
                b: 4
            },
            c: {
                g: {
                    r: {
                        h: 8
                    }
                }
            }
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['x.y'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { g: { r: { h: 8 } } } })
    })

    it('shallow copies the nested keys (non-object)', () => {

        const defaults = {
            // All falsy values:
            _undefined: {
                a: 1
            },
            _null: {
                a: 2
            },
            _false: {
                a: 3
            },
            _emptyString: {
                a: 4
            },
            _zero: {
                a: 5
            },
            _NaN: {
                a: 6
            },
            // Other non-object values:
            _string: {
                a: 7
            },
            _number: {
                a: 8
            },
            _true: {
                a: 9
            },
            _function: {
                a: 10
            }
        }

        const source = {
            _undefined: undefined,
            _null: null,
            _false: false,
            _emptyString: '',
            _zero: 0,
            _NaN: NaN,
            _string: 'foo',
            _number: 42,
            _true: true,
            _function: () => {}
        }

        const merged = Utils.applyToDefaults(defaults, source, { shallow: [
            '_undefined.a',
            '_null.a',
            '_false.a',
            '_emptyString.a',
            '_zero.a',
            '_NaN.a',
            '_string.a',
            '_number.a',
            '_true.a',
            '_function.a'
        ] })
        expect(merged).to.equal({
            _undefined: { a: 1 },
            _null: { a: 2 },
            _false: false,
            _emptyString: '',
            _zero: 0,
            _NaN: NaN,
            _string: 'foo',
            _number: 42,
            _true: true,
            _function: source._function
        })
    })

    it('shallow copies the listed keys in the defaults', () => {

        const defaults = {
            a: {
                b: 1
            }
        }

        const merged = Utils.applyToDefaults(defaults, {}, { shallow: ['a'] })
        expect(merged.a).to.shallow.equal(defaults.a)
    })

    it('shallow copies the listed keys in the defaults (true)', () => {

        const defaults = {
            a: {
                b: 1
            }
        }

        const merged = Utils.applyToDefaults(defaults, true, { shallow: ['a'] })
        expect(merged.a).to.shallow.equal(defaults.a)
    })

    it('returns null on false', () => {

        const defaults = {
            a: {
                b: 1
            }
        }

        const merged = Utils.applyToDefaults(defaults, false, { shallow: ['a'] })
        expect(merged).to.equal(null)
    })

    it('handles missing shallow key in defaults', () => {

        const defaults = {
            a: {
                b: 1
            }
        }

        const options = {
            a: {
                b: 4
            },
            c: {
                d: 2
            }
        }

        const merged = Utils.applyToDefaults(defaults, options, { shallow: ['c'] })
        expect(merged).to.equal({ a: { b: 4 }, c: { d: 2 } })
        expect(merged.c).to.shallow.equal(options.c)

        expect(Utils.applyToDefaults(defaults, true, { shallow: ['c'] })).to.equal({ a: { b: 1 } })
    })

    it('throws on missing defaults', () => {

        expect(() => Utils.applyToDefaults(null, {}, { shallow: ['a'] })).to.throw('Invalid defaults value: must be an object')
    })

    it('throws on invalid defaults', () => {

        expect(() => Utils.applyToDefaults('abc', {}, { shallow: ['a'] })).to.throw('Invalid defaults value: must be an object')
    })

    it('throws on invalid source', () => {

        expect(() => Utils.applyToDefaults({}, 'abc', { shallow: ['a'] })).to.throw('Invalid source value: must be true, falsy or an object')
    })

    it('throws on missing keys', () => {

        expect(() => Utils.applyToDefaults({}, true, { shallow: 123 })).to.throw('Invalid keys')
    })

    it('handles array keys', () => {

        const sym = Symbol()

        const defaults = {
            a: {
                b: 5,
                e: 3
            },
            c: {
                d: 7,
                [sym]: {
                    f: 9
                }
            }
        }

        const options = {
            a: {
                b: 4
            },
            c: {
                d: 6,
                [sym]: {
                    g: 1
                }
            }
        }

        const merged = Utils.applyToDefaults(defaults, options, { shallow: [['c', sym]] })
        expect(merged).to.equal({ a: { b: 4, e: 3 }, c: { d: 6, [sym]: { g: 1 } } })
        expect(merged.c[sym]).to.shallow.equal(options.c[sym])
    })

    it('does not modify shallow entries in source', () => {

        const defaults = {
            a: {
                b: 5
            }
        }

        const source = {}

        Object.defineProperty(source, 'a', { value: { b: 4 } })

        const merged = Utils.applyToDefaults(defaults, source, { shallow: ['a'] })
        expect(merged).to.equal({ a: { b: 4 } })
        expect(merged.a).to.shallow.equal(source.a)
        expect(merged.a).to.not.equal(defaults.a)
    })

    it('should respect nullOverride when shallow is used', () => {

        const defaults = { host: 'localhost', port: 8000 }
        const source = { host: null, port: 8080 }

        const result = Utils.applyToDefaults(defaults, source, { nullOverride: true, shallow: [] })
        expect(result.host).to.equal(null)
        expect(result.port).to.equal(8080)
    })
})

describe('deepEqual()', () => {

    it('compares identical references', () => {

        const x = {}
        expect(Utils.deepEqual(x, x)).to.be.true()
    })

    it('compares simple values', () => {

        expect(Utils.deepEqual('x', 'x')).to.be.true()
        expect(Utils.deepEqual('x', 'y')).to.be.false()
        expect(Utils.deepEqual('x1', 'x')).to.be.false()
        expect(Utils.deepEqual(-0, +0)).to.be.false()
        expect(Utils.deepEqual(-0, -0)).to.be.true()
        expect(Utils.deepEqual(+0, +0)).to.be.true()
        expect(Utils.deepEqual(+0, -0)).to.be.false()
        expect(Utils.deepEqual(1, 1)).to.be.true()
        expect(Utils.deepEqual(0, 0)).to.be.true()
        expect(Utils.deepEqual(-1, 1)).to.be.false()
        expect(Utils.deepEqual(NaN, 0)).to.be.false()
        expect(Utils.deepEqual(NaN, NaN)).to.be.true()
    })

    it('compares different types', () => {

        expect(Utils.deepEqual([], 5, { prototype: false })).to.be.false()
        expect(Utils.deepEqual(5, [], { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, null, { prototype: false })).to.be.false()
        expect(Utils.deepEqual(null, {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual('abc', {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, 'abc', { prototype: false })).to.be.false()
    })

    it('compares empty structures', () => {

        expect(Utils.deepEqual([], [])).to.be.true()
        expect(Utils.deepEqual({}, {})).to.be.true()
        expect(Utils.deepEqual([], {})).to.be.false()
        expect(Utils.deepEqual([], {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, [], { prototype: false })).to.be.false()
    })

    it('compares empty arguments object', () => {

        const compare = function () {

            expect(Utils.deepEqual([], arguments)).to.be.false()            // eslint-disable-line prefer-rest-params
        }

        compare()
    })

    it('compares empty arguments objects', () => {

        const compare = function () {

            const arg1 = arguments                                         // eslint-disable-line prefer-rest-params

            const inner = function () {

                // callee is not supported in strict mode, was previously false becuse callee was different
                expect(Utils.deepEqual(arg1, arguments)).to.be.true()       // eslint-disable-line prefer-rest-params
            }

            inner()
        }

        compare()
    })

    it('compares symbol object properties', () => {

        const sym = Symbol()

        const ne = {}
        Object.defineProperty(ne, sym, { value: true })

        expect(Utils.deepEqual({ [sym]: { c: true } }, { [sym]: { c: true } })).to.be.true()
        expect(Utils.deepEqual({ [sym]: { c: true } }, { [sym]: { c: false } })).to.be.false()
        expect(Utils.deepEqual({ [sym]: { c: true } }, { [sym]: true })).to.be.false()
        expect(Utils.deepEqual({ [sym]: undefined }, { [sym]: undefined })).to.be.true()
        expect(Utils.deepEqual({ [sym]: undefined }, {})).to.be.false()
        expect(Utils.deepEqual({}, { [sym]: undefined })).to.be.false()

        expect(Utils.deepEqual({}, ne)).to.be.true()
        expect(Utils.deepEqual(ne, {})).to.be.true()
        expect(Utils.deepEqual({ [sym]: true }, ne)).to.be.false()
        expect(Utils.deepEqual(ne, { [sym]: true })).to.be.false()
        expect(Utils.deepEqual(ne, { [Symbol()]: undefined })).to.be.false()

        expect(Utils.deepEqual({ [sym]: true }, { [sym]: true })).to.be.true()
        expect(Utils.deepEqual({ [sym]: true }, {})).to.be.false()
        expect(Utils.deepEqual({ [sym]: true }, {}, { symbols: false })).to.be.true()
    })

    it('compares dates', () => {

        expect(Utils.deepEqual(new Date(2015, 1, 1), new Date('2015/02/01'))).to.be.true()
        expect(Utils.deepEqual(new Date(100), new Date(101))).to.be.false()
        expect(Utils.deepEqual(new Date(), {})).to.be.false()
        expect(Utils.deepEqual(new Date(2015, 1, 1), new Date('2015/02/01'), { prototype: false })).to.be.true()
        expect(Utils.deepEqual(new Date(), {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, new Date(), { prototype: false })).to.be.false()
    })

    it('compares regular expressions', () => {

        expect(Utils.deepEqual(/\s/, new RegExp('\\\s'))).to.be.true()
        expect(Utils.deepEqual(/\s/g, /\s/g)).to.be.true()
        expect(Utils.deepEqual(/a/, {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual(/\s/g, /\s/i)).to.be.false()
        expect(Utils.deepEqual(/a/g, /b/g)).to.be.false()
    })

    it('compares errors', () => {

        expect(Utils.deepEqual(new Error('a'), new Error('a'))).to.be.true()
        expect(Utils.deepEqual(new Error('a'), new Error('b'))).to.be.false()

        expect(Utils.deepEqual(new Error('a'), new TypeError('a'))).to.be.false()
        expect(Utils.deepEqual(new Error('a'), new TypeError('a'), { prototype: false })).to.be.false()

        expect(Utils.deepEqual(new Error(), {})).to.be.false()
        expect(Utils.deepEqual(new Error(), {}, { prototype: false })).to.be.false()

        expect(Utils.deepEqual({}, new Error())).to.be.false()
        expect(Utils.deepEqual({}, new Error(), { prototype: false })).to.be.false()

        const error = new Error('a')
        expect(Utils.deepEqual(Utils.clone(error), error)).to.be.true()
        expect(Utils.deepEqual(Utils.clone(error), error, { prototype: false })).to.be.true()
    })

    it('compares arrays', () => {

        expect(Utils.deepEqual([[1]], [[1]])).to.be.true()
        expect(Utils.deepEqual([1, 2, 3], [1, 2, 3])).to.be.true()
        expect(Utils.deepEqual([1, 2, 3], [1, 3, 2])).to.be.false()
        expect(Utils.deepEqual([1, 2, 3], [1, 2])).to.be.false()
        expect(Utils.deepEqual([1], [1])).to.be.true()
        const item1 = { key: 'value1' }
        const item2 = { key: 'value2' }
        expect(Utils.deepEqual([item1, item1], [item1, item2])).to.be.false()
    })

    it('compares sets', () => {

        expect(Utils.deepEqual(new Set(), new Set())).to.be.true()
        expect(Utils.deepEqual(new Set([1]), new Set([1]))).to.be.true()
        expect(Utils.deepEqual(new Set([]), new Set([]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, 2, 3]), new Set([1, 2, 3]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, 2, 3]), new Set([3, 2, 1]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, 2, 3]), new Set([1, 2, 4]))).to.be.false()
        expect(Utils.deepEqual(new Set([1, 2, 3]), new Set([1, 2]))).to.be.false()
        expect(Utils.deepEqual(new Set([1, 2, 1]), new Set([1, 2]))).to.be.true()
        expect(Utils.deepEqual(new Set([+0]), new Set([-0]))).to.be.true()
        expect(Utils.deepEqual(new Set([NaN]), new Set([NaN]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, {}]), new Set([1, {}]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, {}]), new Set([{}, 1]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, {}, {}]), new Set([{}, 1, {}]))).to.be.true()
        expect(Utils.deepEqual(new Set([1, { a: 1 }]), new Set([{ a: 0 }, 1]))).to.be.false()
        expect(Utils.deepEqual(new WeakSet(), new WeakSet())).to.be.true()
        const obj = {}
        expect(Utils.deepEqual(new WeakSet([obj]), new WeakSet())).to.be.true()
        expect(Utils.deepEqual(new WeakSet(), new Set()), { prototype: false }).to.be.false()

        const sets = [new Set(), new Set()].map((set) => {

            set.modified = true
            return set
        })
        expect(Utils.deepEqual(sets[0], sets[1])).to.be.true()
        expect(Utils.deepEqual(sets[0], new Set())).to.be.false()
    })

    it('compares extended sets', () => {

        class PrivateSet extends Set {

            has() {

                throw new Error('not allowed')
            }
        }

        const entries = ['a', undefined]
        expect(Utils.deepEqual(new PrivateSet(), new PrivateSet())).to.be.true()
        expect(Utils.deepEqual(new PrivateSet(entries), new PrivateSet(entries))).to.be.true()
        expect(Utils.deepEqual(new PrivateSet(entries), new Set(entries), { prototype: false })).to.be.true()
        expect(Utils.deepEqual(new PrivateSet(entries), new Set(entries), { prototype: true })).to.be.false()
        expect(Utils.deepEqual(new PrivateSet(), new PrivateSet(entries))).to.be.false()
        expect(Utils.deepEqual(new PrivateSet(entries), new PrivateSet())).to.be.false()

        class LockableSet extends Set {

            constructor(values, locked = true) {

                super(values)
                this.locked = locked
            }

            has() {

                if (this.locked) {
                    throw new Error('not allowed')
                }
            }
        }

        expect(Utils.deepEqual(new LockableSet(), new LockableSet())).to.be.true()
        expect(Utils.deepEqual(new LockableSet(entries), new LockableSet(entries))).to.be.true()
        expect(Utils.deepEqual(new LockableSet(entries, false), new LockableSet(entries, false))).to.be.true()
        expect(Utils.deepEqual(new LockableSet(entries, true), new LockableSet(entries, false))).to.be.false()
        expect(Utils.deepEqual(new LockableSet(entries, false), new LockableSet(entries, true))).to.be.false()
        expect(Utils.deepEqual(new LockableSet(entries), new Set(entries), { prototype: false })).to.be.false()
        expect(Utils.deepEqual(new LockableSet(entries), new PrivateSet(entries), { prototype: false })).to.be.false()
    })

    it('compares maps', () => {

        const item1 = { key: 'value1' }
        const item2 = { key: 'value2' }
        expect(Utils.deepEqual(new Map(), new Map())).to.be.true()
        expect(Utils.deepEqual(new Map([[1, {}]]), new Map([[1, {}]]))).to.be.true()
        expect(Utils.deepEqual(new Map([[1, item1]]), new Map([[1, item1]]))).to.be.true()
        expect(Utils.deepEqual(new Map([[1, item1]]), new Map([[1, item2]]))).to.be.false()
        expect(Utils.deepEqual(new Map([[1, undefined]]), new Map([[1, undefined]]))).to.be.true()
        expect(Utils.deepEqual(new Map([[1, undefined]]), new Map([[2, undefined]]))).to.be.false()
        expect(Utils.deepEqual(new Map([[1, {}]]), new Map([[1, {}], [2, {}]]))).to.be.false()
        expect(Utils.deepEqual(new Map([[item1, 1]]), new Map([[item1, 1]]))).to.be.true()
        expect(Utils.deepEqual(new Map([[{}, 1]]), new Map([[{}, 1]]))).to.be.false()
        expect(Utils.deepEqual(new WeakMap(), new WeakMap())).to.be.true()
        expect(Utils.deepEqual(new WeakMap([[item1, 1]]), new WeakMap())).to.be.true()
        expect(Utils.deepEqual(new WeakMap(), new Map()), { prototype: false }).to.be.false()

        const maps = [new Map(), new Map()].map((map) => {

            map.modified = true
            return map
        })
        expect(Utils.deepEqual(maps[0], maps[1])).to.be.true()
        expect(Utils.deepEqual(maps[0], new Map())).to.be.false()
    })

    it('compares extended maps', () => {

        class PrivateMap extends Map {

            get() {

                throw new Error('not allowed')
            }
        }

        const entries = [['a', 1], ['b', undefined]]
        expect(Utils.deepEqual(new PrivateMap(), new PrivateMap())).to.be.true()
        expect(Utils.deepEqual(new PrivateMap(entries), new PrivateMap(entries))).to.be.true()
        expect(Utils.deepEqual(new PrivateMap(entries), new Map(entries), { prototype: false })).to.be.true()
        expect(Utils.deepEqual(new PrivateMap(entries), new Map(entries), { prototype: true })).to.be.false()
        expect(Utils.deepEqual(new PrivateMap(), new PrivateMap(entries))).to.be.false()
        expect(Utils.deepEqual(new PrivateMap(entries), new PrivateMap())).to.be.false()

        class LockableMap extends Map {

            constructor(kvs, locked = true) {

                super(kvs)
                this.locked = locked
            }

            get() {

                if (this.locked) {
                    throw new Error('not allowed')
                }
            }
        }

        expect(Utils.deepEqual(new LockableMap(), new LockableMap())).to.be.true()
        expect(Utils.deepEqual(new LockableMap(entries), new LockableMap(entries))).to.be.true()
        expect(Utils.deepEqual(new LockableMap(entries, false), new LockableMap(entries, false))).to.be.true()
        expect(Utils.deepEqual(new LockableMap(entries, true), new LockableMap(entries, false))).to.be.false()
        expect(Utils.deepEqual(new LockableMap(entries, false), new LockableMap(entries, true))).to.be.false()
        expect(Utils.deepEqual(new LockableMap(entries), new Map(entries), { prototype: false })).to.be.false()
        expect(Utils.deepEqual(new LockableMap(entries), new PrivateMap(entries), { prototype: false })).to.be.false()
    })

    it('compares promises', () => {

        const a = new Promise(() => { })

        expect(Utils.deepEqual(a, a)).to.be.true()
        expect(Utils.deepEqual(a, new Promise(() => { }))).to.be.false()
    })

    it('compares urls', () => {

        const a = new URL('https://example.com/')

        expect(Utils.deepEqual(a, a)).to.be.true()
        expect(Utils.deepEqual(a, new URL('https://example.com/?new'))).to.be.false()
        expect(Utils.deepEqual(a, {}, { prototype: false })).to.be.false()
    })

    it('compares buffers', () => {

        expect(Utils.deepEqual(Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3]))).to.be.true()
        expect(Utils.deepEqual(Buffer.from([1, 2, 3]), Buffer.from([1, 3, 2]))).to.be.false()
        expect(Utils.deepEqual(Buffer.from([1, 2, 3]), Buffer.from([1, 2]))).to.be.false()
        expect(Utils.deepEqual(Buffer.from([1, 2, 3]), {})).to.be.false()
        expect(Utils.deepEqual(Buffer.from([1, 2, 3]), [1, 2, 3])).to.be.false()
    })

    it('compares string objects', () => {

        /* eslint-disable no-new-wrappers */
        expect(Utils.deepEqual(new String('a'), new String('a'))).to.be.true()
        expect(Utils.deepEqual(new String('a'), new String('b'))).to.be.false()
        expect(Utils.deepEqual(new String(''), {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, new String(''), { prototype: false })).to.be.false()
        expect(Utils.deepEqual(new String('a'), 'a', { prototype: false })).to.be.false()
        expect(Utils.deepEqual('a', new String('a'), { prototype: false })).to.be.false()
        /* eslint-enable no-new-wrappers */
    })

    it('compares number objects', () => {

        /* eslint-disable no-new-wrappers */
        expect(Utils.deepEqual(new Number(1), new Number(1))).to.be.true()
        expect(Utils.deepEqual(new Number(1), new Number(2))).to.be.false()
        expect(Utils.deepEqual(new Number(+0), new Number(-0))).to.be.false()
        expect(Utils.deepEqual(new Number(NaN), new Number(NaN))).to.be.true()
        expect(Utils.deepEqual(new Number(0), {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, new Number(0), { prototype: false })).to.be.false()
        expect(Utils.deepEqual(new Number(1), 1, { prototype: false })).to.be.false()
        expect(Utils.deepEqual(1, new Number(1), { prototype: false })).to.be.false()
        /* eslint-enable no-new-wrappers */
    })

    it('compares boolean objects', () => {

        /* eslint-disable no-new-wrappers */
        expect(Utils.deepEqual(new Boolean(true), new Boolean(true))).to.be.true()
        expect(Utils.deepEqual(new Boolean(true), new Boolean(false))).to.be.false()
        expect(Utils.deepEqual(new Boolean(false), {}, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({}, new Boolean(false), { prototype: false })).to.be.false()
        expect(Utils.deepEqual(new Boolean(true), true, { prototype: false })).to.be.false()
        expect(Utils.deepEqual(true, new Boolean(true), { prototype: false })).to.be.false()
        /* eslint-enable no-new-wrappers */
    })

    it('compares objects', () => {

        expect(Utils.deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3 })).to.be.true()
        expect(Utils.deepEqual({ foo: 'bar' }, { foo: 'baz' })).to.be.false()
        expect(Utils.deepEqual({ foo: { bar: 'foo' } }, { foo: { bar: 'baz' } })).to.be.false()
        expect(Utils.deepEqual({ foo: undefined }, {})).to.be.false()
        expect(Utils.deepEqual({}, { foo: undefined })).to.be.false()
        expect(Utils.deepEqual({ foo: undefined }, { bar: undefined })).to.be.false()
    })

    it('compares functions', () => {

        const f1 = () => 1
        const f2 = () => 2
        const f2a = () => 2

        expect(Utils.deepEqual({ f1 }, { f1 })).to.be.true()
        expect(Utils.deepEqual({ f1 }, { f1: f2 })).to.be.false()
        expect(Utils.deepEqual({ f2 }, { f2: f2a })).to.be.false()
        expect(Utils.deepEqual({ f2 }, { f2: f2a }, { deepFunction: true })).to.be.true()
        expect(Utils.deepEqual({ f2 }, { f2: f1 }, { deepFunction: true })).to.be.false()

        const f3 = () => 3
        f3.x = 1

        const f3a = () => 3
        f3a.x = 1

        const f3b = () => 3
        f3b.x = 2

        expect(Utils.deepEqual({ f3 }, { f3: f3a }, { deepFunction: true })).to.be.true()
        expect(Utils.deepEqual({ f3 }, { f3: f3b }, { deepFunction: true })).to.be.false()
    })

    it('skips keys', () => {

        expect(Utils.deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 4 })).to.be.false()
        expect(Utils.deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 4 }, { skip: ['c'] })).to.be.true()

        expect(Utils.deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 })).to.be.false()
        expect(Utils.deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 }, { skip: ['c'] })).to.be.true()

        const sym = Symbol('test')
        expect(Utils.deepEqual({ a: 1, b: 2, [sym]: 3 }, { a: 1, b: 2, [sym]: 4 })).to.be.false()
        expect(Utils.deepEqual({ a: 1, b: 2, [sym]: 3 }, { a: 1, b: 2, [sym]: 4 }, { skip: [sym] })).to.be.true()

        expect(Utils.deepEqual({ a: 1, b: 2, [sym]: 3 }, { a: 1, b: 2 })).to.be.false()
        expect(Utils.deepEqual({ a: 1, b: 2, [sym]: 3 }, { a: 1, b: 2 }, { skip: [sym] })).to.be.true()
        expect(Utils.deepEqual({ a: 1, b: 2, [sym]: 3, [Symbol('other')]: true }, { a: 1, b: 2 }, { skip: [sym] })).to.be.false()

        expect(Utils.deepEqual({ a: 1, b: 2 }, { a: 1 }, { skip: ['a'] })).to.be.false()
        expect(Utils.deepEqual({ a: 1 }, { a: 1, b: 2 }, { skip: ['a'] })).to.be.false()
    })

    it('handles circular dependency', () => {

        const a = {}
        a.x = a

        const b = Utils.clone(a)
        expect(Utils.deepEqual(a, b)).to.be.true()
    })

    it('handles obj only circular dependency', () => {

        const a = {}
        a.x = a

        const b = { x: {} }
        expect(Utils.deepEqual(a, b)).to.be.false()
        expect(Utils.deepEqual(b, a)).to.be.false()
    })

    it('handles irregular circular dependency', () => {

        const a = {}
        a.x = a

        const b = { x: {} }
        b.x.x = b

        const c = { x: { x: {} } }
        c.x.x.x = c
        expect(Utils.deepEqual(a, b)).to.be.true()
        expect(Utils.deepEqual(b, a)).to.be.true()
        expect(Utils.deepEqual(a, c)).to.be.true()
        expect(Utils.deepEqual(b, c)).to.be.true()
        expect(Utils.deepEqual(c, a)).to.be.true()
        expect(Utils.deepEqual(c, b)).to.be.true()
        b.x.y = 1
        expect(Utils.deepEqual(a, b)).to.be.false()
        expect(Utils.deepEqual(b, a)).to.be.false()
    })

    it('handles cross circular dependency', () => {

        const a = {}
        const b = { x: {}, y: a }
        b.x.x = b
        b.x.y = b.x
        a.x = b
        a.y = a
        expect(Utils.deepEqual(b, a)).to.be.true()
        expect(Utils.deepEqual(a, b)).to.be.true()
        b.x.y = 1
        expect(Utils.deepEqual(b, a)).to.be.false()
        expect(Utils.deepEqual(a, b)).to.be.false()
    })

    it('handles reuse of objects', () => {

        const date1 = { year: 2018, month: 1, day: 1 }
        const date2 = { year: 2000, month: 1, day: 1 }

        expect(Utils.deepEqual({ start: date1, end: date1 }, { start: date1, end: date2 })).to.be.false()
    })

    it('handles valueOf() that throws', () => {

        const throwing = class {

            constructor(value) {

                this.value = value
            }

            valueOf() {

                throw new Error('failed')
            }
        }

        expect(Utils.deepEqual(new throwing('a'), new throwing('a'))).to.be.true()
        expect(Utils.deepEqual(new throwing('a'), new throwing('b'))).to.be.false()
        expect(Utils.deepEqual(new throwing('a'), { value: 'a' }, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({ value: 'a' }, new throwing('a'), { prototype: false })).to.be.false()
    })

    it('handles valueOf() that returns similar value', () => {

        const identity = class {

            constructor(value) {

                this.value = value
            }

            valueOf() {

                return { value: this.value }
            }
        }

        expect(Utils.deepEqual(new identity('a'), new identity('a'))).to.be.true()
        expect(Utils.deepEqual(new identity('a'), new identity('b'))).to.be.false()
        expect(Utils.deepEqual(new identity('a'), { value: 'a' }, { prototype: true })).to.be.false()
        expect(Utils.deepEqual(new identity('a'), { value: 'a' }, { prototype: false })).to.be.true()
        expect(Utils.deepEqual({ value: 'a' }, new identity('a'), { prototype: true })).to.be.false()
        expect(Utils.deepEqual({ value: 'a' }, new identity('a'), { prototype: false })).to.be.true()
    })

    it('skips enumerable properties on prototype chain', () => {

        const base = function (value, surprice) {

            this.value = value
            if (surprice) {
                this.surprice = surprice
            }
        }

        Object.defineProperty(base.prototype, 'enum', {
            enumerable: true,
            configurable: true,
            value: true
        })

        expect('enum' in new base('a')).to.be.true()
        expect(Utils.deepEqual(new base('a'), new base('a'))).to.be.true()
        expect(Utils.deepEqual(new base('a'), new base('b'))).to.be.false()
        expect(Utils.deepEqual(new base('a'), { value: 'a' }, { prototype: false })).to.be.true()
        expect(Utils.deepEqual({ value: 'a' }, new base('a'), { prototype: false })).to.be.true()
        expect(Utils.deepEqual(new base('a', 1), { value: 'a', enum: true }, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({ value: 'a', enum: true }, new base('a', 1), { prototype: false })).to.be.false()
    })

    it('skips non-enumerable properties', () => {

        const base = function Base(value, surprice) {

            this.value = value
            if (surprice) {
                this.surprice = surprice
            }
        }

        const createObj = (...args) => {

            const obj = new base(...args)

            Object.defineProperty(obj, 'hidden', {
                enumerable: false,
                configurable: true,
                value: true
            })

            return obj
        }

        expect(Utils.deepEqual(createObj('a'), createObj('a'))).to.be.true()
        expect(Utils.deepEqual(createObj('a'), createObj('b'))).to.be.false()
        expect(Utils.deepEqual(createObj('a'), { value: 'a' }, { prototype: false })).to.be.true()
        expect(Utils.deepEqual({ value: 'a' }, createObj('a'), { prototype: false })).to.be.true()
        expect(Utils.deepEqual(createObj('a', 1), { value: 'a', hidden: true }, { prototype: false })).to.be.false()
        expect(Utils.deepEqual({ value: 'a', hidden: true }, createObj('a', 1), { prototype: false })).to.be.false()
    })

    it('compares an object with property getter while executing it', () => {

        const obj = {}
        const value = 1
        let execCount = 0

        Object.defineProperty(obj, 'test', {
            enumerable: true,
            configurable: true,
            get: function () {

                ++execCount
                return value
            }
        })

        const copy = Utils.clone(obj)
        expect(Utils.deepEqual(obj, copy)).to.be.true()
        expect(execCount).to.equal(2)
        expect(copy.test).to.equal(1)
        expect(execCount).to.equal(3)
    })

    it('compares objects with property getters', () => {

        const obj = {}
        Object.defineProperty(obj, 'test', {
            enumerable: true,
            configurable: true,
            get: function () {

                return 1
            }
        })

        const ref = {}
        Object.defineProperty(ref, 'test', {
            enumerable: true,
            configurable: true,
            get: function () {

                return 2
            }
        })

        expect(Utils.deepEqual(obj, ref)).to.be.false()
    })

    it('compares object prototypes', () => {

        const Obj = function () {

            this.a = 5
        }

        Obj.prototype.b = function () {

            return this.a
        }

        const Ref = function () {

            this.a = 5
        }

        Ref.prototype.b = function () {

            return this.a
        }

        expect(Utils.deepEqual(new Obj(), new Ref())).to.be.false()
        expect(Utils.deepEqual(new Obj(), new Obj())).to.be.true()
        expect(Utils.deepEqual(new Ref(), new Ref())).to.be.true()
    })

    it('compares plain objects', () => {

        const a = Object.create(null)
        const b = Object.create(null)

        a.b = 'c'
        b.b = 'c'

        expect(Utils.deepEqual(a, b)).to.be.true()
        expect(Utils.deepEqual(a, { b: 'c' })).to.be.false()
    })

    it('compares an object with an empty object', () => {

        const a = { a: 1, b: 2 }

        expect(Utils.deepEqual({}, a)).to.be.false()
        expect(Utils.deepEqual(a, {})).to.be.false()
    })

    it('compares an object ignoring the prototype', () => {

        const a = Object.create(null)
        const b = {}

        expect(Utils.deepEqual(a, b, { prototype: false })).to.be.true()
    })

    it('compares an object ignoring the prototype recursively', () => {

        const a = [Object.create(null)]
        const b = [{}]

        expect(Utils.deepEqual(a, b, { prototype: false })).to.be.true()
    })
})

describe('reach()', () => {

    const sym = Symbol()
    const obj = {
        a: {
            b: {
                c: {
                    d: 1,
                    e: 2
                },
                f: 'hello'
            },
            g: {
                h: 3
            },
            '-2': true,
            [sym]: {
                v: true
            }
        },
        i: function () { },
        j: null,
        k: [4, 8, 9, 1]
    }

    obj.i.x = 5

    it('returns object itself', () => {

        expect(Utils.reach(obj, null)).to.equal(obj)
        expect(Utils.reach(obj, false)).to.equal(obj)
        expect(Utils.reach(obj)).to.equal(obj)
        expect(Utils.reach(obj, [])).to.equal(obj)
    })

    it('returns values of array', () => {

        expect(Utils.reach(obj, 'k.0')).to.equal(4)
        expect(Utils.reach(obj, 'k.1')).to.equal(8)
    })

    it('returns last value of array using negative index', () => {

        expect(Utils.reach(obj, 'k.-1')).to.equal(1)
        expect(Utils.reach(obj, 'k.-2')).to.equal(9)
    })

    it('returns object property with negative index for non-array', () => {

        expect(Utils.reach(obj, 'a.-2')).to.be.equal(true)
    })

    it('returns a valid member', () => {

        expect(Utils.reach(obj, 'a.b.c.d')).to.equal(1)
    })

    it('returns a valid member with separator override', () => {

        expect(Utils.reach(obj, 'a/b/c/d', '/')).to.equal(1)
    })

    it('returns undefined on null object', () => {

        expect(Utils.reach(null, 'a.b.c.d')).to.equal(undefined)
    })

    it('returns undefined on missing object member', () => {

        expect(Utils.reach(obj, 'a.b.c.d.x')).to.equal(undefined)
    })

    it('returns undefined on missing function member', () => {

        expect(Utils.reach(obj, 'i.y', { functions: true })).to.equal(undefined)
    })

    it('throws on missing member in strict mode', () => {

        expect(() => {

            Utils.reach(obj, 'a.b.c.o.x', { strict: true })
        }).to.throw('Missing segment o in reach path  a.b.c.o.x')

    })

    it('returns undefined on invalid member', () => {

        expect(Utils.reach(obj, 'a.b.c.d-.x')).to.equal(undefined)
        expect(Utils.reach(obj, 'k.x')).to.equal(undefined)
        expect(Utils.reach(obj, 'k.1000')).to.equal(undefined)
        expect(Utils.reach(obj, 'k/0.5', '/')).to.equal(undefined)
    })

    it('returns function member', () => {

        expect(typeof Utils.reach(obj, 'i')).to.equal('function')
    })

    it('returns function property', () => {

        expect(Utils.reach(obj, 'i.x')).to.equal(5)
    })

    it('returns null', () => {

        expect(Utils.reach(obj, 'j')).to.equal(null)
    })

    it('throws on function property when functions not allowed', () => {

        expect(() => {

            Utils.reach(obj, 'i.x', { functions: false })
        }).to.throw('Invalid segment x in reach path  i.x')
    })

    it('will return a default value if property is not found', () => {

        expect(Utils.reach(obj, 'a.b.q', { default: 'defaultValue' })).to.equal('defaultValue')
    })

    it('will return a default value if path is not found', () => {

        expect(Utils.reach(obj, 'q', { default: 'defaultValue' })).to.equal('defaultValue')
    })

    it('allows a falsey value to be used as the default value', () => {

        expect(Utils.reach(obj, 'q', { default: '' })).to.equal('')
    })

    it('allows array-based lookup', () => {

        expect(Utils.reach(obj, ['a', 'b', 'c', 'd'])).to.equal(1)
        expect(Utils.reach(obj, ['k', '1'])).to.equal(8)
        expect(Utils.reach(obj, ['k', 1])).to.equal(8)
        expect(Utils.reach(obj, ['k', '-2'])).to.equal(9)
        expect(Utils.reach(obj, ['k', -2])).to.equal(9)
    })

    it('allows array-based lookup with symbols', () => {

        expect(Utils.reach(obj, ['a', sym, 'v'])).to.equal(true)
        expect(Utils.reach(obj, ['a', Symbol(), 'v'])).to.equal(undefined)
    })

    it('returns character in string', () => {

        expect(Utils.reach(['abc'], [0])).to.equal('abc')
        expect(Utils.reach(['abc'], ['0'])).to.equal('abc')
    })

    it('reaches sets and maps', () => {

        const value = {
            a: {
                b: new Set([
                    { x: 1 },
                    { x: 2 },
                    {
                        y: new Map([
                            ['v', 4],
                            ['w', 5]
                        ])
                    }
                ])
            }
        }

        expect(Utils.reach(value, 'a.b.2.y.w')).to.not.exist()
        expect(Utils.reach(value, 'a.b.2.y.w', { iterables: true })).to.equal(5)
    })
})

describe('assert()', () => {

    it('throws an Error when using assert in a test', () => {

        expect(() => {

            Utils.assert(false, 'my error message')
        }).to.throw(Utils.AssertError, 'my error message')
    })

    it('throws an Error when using assert in a test with no message', () => {

        expect(() => {

            Utils.assert(false)
        }).to.throw(Utils.AssertError, 'Unknown error')
    })

    it('throws an Error when using assert in a test with multipart message', () => {

        expect(() => {

            Utils.assert(false, 'This', 'is', 'my message')
        }).to.throw(Utils.AssertError, 'This is my message')
    })

    it('throws an Error when using assert in a test with multipart message (empty)', () => {

        expect(() => {

            Utils.assert(false, 'This', 'is', '', 'my message')
        }).to.throw(Utils.AssertError, 'This is my message')
    })

    it('throws an Error when using assert in a test with object message', () => {

        expect(() => {

            Utils.assert(false, 'This', 'is', { spinal: 'tap' })
        }).to.throw(Utils.AssertError, 'This is {"spinal":"tap"}')
    })

    it('throws an Error when using assert in a test with multipart string and error messages', () => {

        expect(() => {

            Utils.assert(false, new Error('This'), 'is', 'spinal', new Error('tap'))
        }).to.throw(Utils.AssertError, 'This is spinal tap')
    })

    it('throws an Error when using assert in a test with error object message', () => {

        const err = new TypeError('This is spinal tap')
        const got = expect(() => Utils.assert(false, err)).to.throw(TypeError, 'This is spinal tap')
        expect(got).to.shallow.equal(err)
    })

    it('throws the same Error that is passed to it if there is only one error passed', () => {

        const error = new Error('ruh roh')
        const error2 = new Error('ruh roh')

        const fn = function () {

            Utils.assert(false, error)
        }

        try {
            fn()
        }
        catch (err) {
            expect(err).to.equal(error)  // should be the same reference
            expect(err).to.not.shallow.equal(error2) // error with the same message should not match
        }
    })
})

describe('AssertError', () => {

    it('takes an optional message', () => {

        expect(new Utils.AssertError().message).to.equal('Unknown error')
        expect(new Utils.AssertError(null).message).to.equal('Unknown error')
        expect(new Utils.AssertError('msg').message).to.equal('msg')
    })

    it('has AssertError name property', () => {

        expect(new Utils.AssertError().name).to.equal('AssertError')
        expect(new Utils.AssertError('msg').name).to.equal('AssertError')
    })

    it('uses ctor argument to hide stack', { skip: typeof Error.captureStackTrace !== 'function' }, () => {

        const parentFn = () => {

            throw new Utils.AssertError('msg', parentFn)
        }

        const err = expect(parentFn).to.throw(Utils.AssertError)

        expect(err.stack).to.not.contain('parentFn')
    })
})

describe('escapeRegex()', () => {

    it('escapes all special regular expression characters', () => {

        const a = Utils.escapeRegex('4^f$s.4*5+-_?%=#!:@|~\\/`"(>)[<]d{}s,')
        expect(a).to.equal('4\\^f\\$s\\.4\\*5\\+\\-_\\?%\\=#\\!\\:@\\|~\\\\\\/`"\\(>\\)\\[<\\]d\\{\\}s\\,')
    })
})

describe('escapeHtml()', () => {

    it('escapes all special HTML characters', () => {

        const a = Utils.escapeHtml('&<>"\'`')
        expect(a).to.equal('&amp;&lt;&gt;&quot;&#x27;&#x60;')
    })

    it('returns empty string on falsy input', () => {

        const a = Utils.escapeHtml('')
        expect(a).to.equal('')
    })

    it('returns unchanged string on no reserved input', () => {

        const a = Utils.escapeHtml('abc')
        expect(a).to.equal('abc')
    })
})

describe('ignore()', () => {

    it('exists', () => {

        expect(Utils.ignore).to.exist()
        expect(typeof Utils.ignore).to.equal('function')
    })
})

describe('stringify()', () => {

    it('converts object to string', () => {

        const obj = { a: 1 }
        expect(Utils.stringify(obj)).to.equal('{"a":1}')
    })

    it('returns error in result string', () => {

        const obj = { a: 1 }
        obj.b = obj
        expect(Utils.stringify(obj)).to.contain('Cannot display object')
    })
})
