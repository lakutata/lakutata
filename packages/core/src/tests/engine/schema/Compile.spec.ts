/**
 * Ported from the upstream test/compile.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
//Adapted: upstream tests schemas of an older release (an older upstream release, not a dependency). The engine detects schemas of other
//versions only through the version of the shared schema marker, so a schema of another version is simulated with that marker.
const LegacyVersion = '15.1.1'
const Legacy = {
    number: () => {

        const schema = Engine.number()
        const marker = Symbol.for('@lakutata/validation/schema')
        return Object.create(schema, {[marker]: {value: {...schema[marker], version: LegacyVersion}}})
    }
}
import * as Helper from './Helper.js'
const internals = {}

describe('cast', () => {

    describe('schema()', () => {

        it('casts templates', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.x('{a + 1}')
            })

            Helper.validate(schema, [[{ a: 5, b: 6 }, true]])
        })

        it('compiles null schema', () => {

            Helper.validate(Engine.compile(null), [
                ['a', false, {
                    message: '"value" must be [null]',
                    path: [],
                    type: 'any.only',
                    context: { value: 'a', valids: [null], label: 'value' }
                }],
                [null, true]
            ])
        })

        it('compiles number literal', () => {

            Helper.validate(Engine.compile(5), [
                [6, false, {
                    message: '"value" must be [5]',
                    path: [],
                    type: 'any.only',
                    context: { value: 6, valids: [5], label: 'value' }
                }],
                [5, true]
            ])
        })

        it('compiles string literal', () => {

            Helper.validate(Engine.compile('5'), [
                ['6', false, {
                    message: '"value" must be [5]',
                    path: [],
                    type: 'any.only',
                    context: { value: '6', valids: ['5'], label: 'value' }
                }],
                ['5', true]
            ])
        })

        it('compiles boolean literal', () => {

            Helper.validate(Engine.compile(true), [
                [false, false, {
                    message: '"value" must be [true]',
                    path: [],
                    type: 'any.only',
                    context: { value: false, valids: [true], label: 'value' }
                }],
                [true, true]
            ])
        })

        it('compiles date literal', () => {

            const now = Date.now()
            const dnow = new Date(now)
            Helper.validate(Engine.compile(dnow), [
                [new Date(now), true],
                [now, true, new Date(now)],
                [now * 2, false, {
                    message: `"value" must be [${dnow.toISOString()}]`,
                    path: [],
                    type: 'any.only',
                    context: { value: new Date(now * 2), valids: [dnow], label: 'value' }
                }]
            ])
        })

        it('compile [null]', () => {

            const schema = Engine.compile([null])
            Helper.equal(schema, Engine.valid(Engine.override, null))
        })

        it('compile [1]', () => {

            const schema = Engine.compile([1])
            Helper.equal(schema, Engine.valid(Engine.override, 1))
        })

        it('compile ["a"]', () => {

            const schema = Engine.compile(['a'])
            Helper.equal(schema, Engine.valid(Engine.override, 'a'))
        })

        it('compile [null, null, null]', () => {

            const schema = Engine.compile([null])
            Helper.equal(schema, Engine.valid(Engine.override, null))
        })

        it('compile [1, 2, 3]', () => {

            const schema = Engine.compile([1, 2, 3])
            Helper.equal(schema, Engine.valid(Engine.override, 1, 2, 3))
        })

        it('compile ["a", "b", "c"]', () => {

            const schema = Engine.compile(['a', 'b', 'c'])
            Helper.equal(schema, Engine.valid(Engine.override, 'a', 'b', 'c'))
        })

        it('compile [null, "a", 1, true]', () => {

            const schema = Engine.compile([null, 'a', 1, true])
            Helper.equal(schema, Engine.valid(Engine.override, null, 'a', 1, true))
        })
    })

    describe('compile()', () => {

        it('compiles object with plain keys', () => {

            const schema = {
                a: 1
            }

            expect(Engine.isSchema(schema)).to.be.false()

            const compiled = Engine.compile(schema)
            expect(Engine.isSchema(compiled)).to.be.true()
        })

        it('compiles object with schema keys', () => {

            const schema = {
                a: Engine.number()
            }

            expect(Engine.isSchema(schema)).to.be.false()

            const compiled = Engine.compile(schema)
            expect(Engine.isSchema(compiled)).to.be.true()
        })

        it('errors on legacy schema', () => {

            const schema = Legacy.number()
            expect(() => Engine.compile(schema)).to.throw(`Cannot mix different versions of validation schemas: ${LegacyVersion} ${Engine.version}`)
            expect(() => Engine.compile(schema, { legacy: true })).to.not.throw()
        })

        it('errors on legacy keys', () => {

            const schema = {
                a: Legacy.number()
            }

            expect(() => Engine.compile(schema)).to.throw('Cannot mix different versions of validation schemas (a)')
        })

        describe('legacy', () => {

            it('compiles object with plain keys', () => {

                const schema = {
                    a: 1,
                    b: [2, 3]
                }

                expect(Engine.isSchema(schema)).to.be.false()

                const compiled = Engine.compile(schema, { legacy: true })
                expect(Engine.isSchema(compiled)).to.be.true()
            })

            it('compiles object with schema keys (v16)', () => {

                const schema = {
                    a: Engine.number()
                }

                expect(Engine.isSchema(schema)).to.be.false()

                const compiled = Engine.compile(schema, { legacy: true })
                expect(Engine.isSchema(compiled)).to.be.true()
            })

            it('compiles object with schema array items (v16)', () => {

                const schema = {
                    a: [Engine.number()]
                }

                expect(Engine.isSchema(schema)).to.be.false()

                const compiled = Engine.compile(schema, { legacy: true })
                expect(Engine.isSchema(compiled)).to.be.true()
            })

            //Skipped: compiling v15 schemas needs the real compiler of an older engine release, which is not a dependency
            it.skip('compiles object with schema keys (v15)', () => {

                const schema = {
                    a: Legacy.number()
                }

                expect(Engine.isSchema(schema)).to.be.false()

                const compiled = Engine.compile(schema, { legacy: true })
                expect(Engine.isSchema(compiled, { legacy: true })).to.be.true()
                expect(() => Engine.isSchema(compiled)).to.throw('Cannot mix different versions of validation schemas')
            })

            //Skipped: compiling v15 schemas needs the real compiler of an older engine release, which is not a dependency
            it.skip('compiles object with schema keys (v15)', () => {

                const schema = {
                    a: [Legacy.number()]
                }

                expect(Engine.isSchema(schema)).to.be.false()

                const compiled = Engine.compile(schema, { legacy: true })
                expect(Engine.isSchema(compiled, { legacy: true })).to.be.true()
                expect(() => Engine.isSchema(compiled)).to.throw('Cannot mix different versions of validation schemas')
            })
        })
    })
})
