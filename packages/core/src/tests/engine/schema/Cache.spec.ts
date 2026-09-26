/**
 * Ported from joi/test/cache.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
const internals = {}

describe('Cache', () => {

    describe('schema', () => {

        it('caches values', () => {

            const schema = Engine.string().pattern(/abc/).cache()

            const validate = schema._definition.rules.pattern.validate
            let count = 0
            schema._definition.rules.pattern.validate = function (...args) {

                ++count
                return validate(...args)
            }

            expect(schema.validate('xabcd').error).to.not.exist()
            expect(schema.validate('xabcd').error).to.not.exist()
            expect(schema.validate('xabcd').error).to.not.exist()

            expect(count).to.equal(1)

            schema._definition.rules.pattern.validate = validate
        })

        it('caches values (object key)', () => {

            const a = Engine.string().pattern(/abc/).cache()
            const schema = Engine.object({ a })

            const validate = a._definition.rules.pattern.validate
            let count = 0
            a._definition.rules.pattern.validate = function (...args) {

                ++count
                return validate(...args)
            }

            expect(schema.validate({ a: 'xabcd' }).error).to.not.exist()
            expect(schema.validate({ a: 'xabcd' }).error).to.not.exist()
            expect(schema.validate({ a: 'xabcd' }).error).to.not.exist()

            expect(count).to.equal(1)

            a._definition.rules.pattern.validate = validate
        })

        it('caches errors', () => {

            const schema = Engine.string().pattern(/abc/).cache()

            const validate = schema._definition.rules.pattern.validate
            let count = 0
            schema._definition.rules.pattern.validate = function (...args) {

                ++count
                return validate(...args)
            }

            const err = schema.validate('xbcd').error
            expect(schema.validate('xbcd').error).to.equal(err)
            expect(schema.validate('xbcd').error).to.equal(err)
            expect(schema.validate('xbcd').error).to.equal(err)

            expect(count).to.equal(1)

            schema._definition.rules.pattern.validate = validate
        })

        it('skips caching when prefs disabled', () => {

            const cache = Engine.cache.provision()
            const schema = Engine.string().pattern(/abc/).cache(cache)

            const validate = schema._definition.rules.pattern.validate
            let count = 0
            schema._definition.rules.pattern.validate = function (...args) {

                ++count
                return validate(...args)
            }

            expect(schema.validate('xabcd', { cache: false }).error).to.not.exist()
            expect(schema.validate('xabcd', { cache: false }).error).to.not.exist()
            expect(schema.validate('xabcd', { cache: false }).error).to.not.exist()

            expect(count).to.equal(3)

            schema._definition.rules.pattern.validate = validate
        })

        it('skips caching when schema contains refs', () => {

            const a = Engine.string().allow(Engine.ref('b')).pattern(/abc/).cache()
            const schema = Engine.object({
                a,
                b: Engine.any()
            })

            const validate = a._definition.rules.pattern.validate
            let count = 0
            a._definition.rules.pattern.validate = function (...args) {

                ++count
                return validate(...args)
            }

            expect(schema.validate({ a: 'xabcd' }).error).to.not.exist()
            expect(schema.validate({ a: 'xabcd' }).error).to.not.exist()
            expect(schema.validate({ a: 'xabcd' }).error).to.not.exist()

            expect(count).to.equal(3)

            a._definition.rules.pattern.validate = validate
        })
    })

    describe('provider', () => {

        describe('provision()', () => {

            it('generates cache', () => {

                const cache = Engine.cache.provision({ max: 5 })

                cache.set(1, 'x')
                expect(cache.get(1)).to.equal('x')

                cache.set(2, 'y')
                expect(cache.get(2)).to.equal('y')

                cache.set(3, 'z')
                expect(cache.get(3)).to.equal('z')

                cache.set('a', 'b')
                expect(cache.get('a')).to.equal('b')

                cache.set('b', 'c')
                expect(cache.get('b')).to.equal('c')

                cache.set({}, 'ignore')
                expect(cache.get({})).to.not.exist()

                cache.set(1, 'v')
                expect(cache.get(1)).to.equal('v')

                cache.set(null, 'x')
                expect(cache.get(null)).to.equal('x')

                expect(cache).to.have.length(5)

                expect(cache.get(2)).to.not.exist()
                expect(cache.get(1)).to.equal('v')
            })
        })

        describe('Engine.cache', () => {

            it('generates cache with default max', () => {

                const cache = Engine.cache.provision()
                for (let i = 0; i < 1020; ++i) {
                    cache.set(i, i + 10)
                    expect(cache.get(i)).to.equal(i + 10)
                }

                expect(cache).to.have.length(1000)
            })

            it('errors on invalid max option', () => {

                expect(() => Engine.cache.provision({ max: null })).to.throw('Invalid max cache size')
                expect(() => Engine.cache.provision({ max: Infinity })).to.throw('Invalid max cache size')
                expect(() => Engine.cache.provision({ max: -1 })).to.throw('Invalid max cache size')
                expect(() => Engine.cache.provision({ max: 0 })).to.throw('Invalid max cache size')
            })
        })
    })
})
