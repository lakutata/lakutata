/**
 * Ported from joi/test/types/any.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../../support/Expect.js'
import Engine from '../../../../lib/validation/engine/schema/index.js'
import * as Helper from '../Helper.js'
const internals = {}

describe('any', () => {

    describe('custom()', () => {

        it('uses custom validation', () => {

            const error = new Error('nope')
            const method = (value, helpers) => {

                if (value === '1') {
                    throw error
                }

                if (value === '2') {
                    return '3'
                }

                if (value === '4') {
                    return helpers.error('any.invalid')
                }

                if (value === '5') {
                    return undefined
                }

                return value
            }

            const schema = Engine.string().custom(method, 'custom validation')
            Helper.validate(schema, [
                ['x', true, 'x'],
                ['2', true, '3'],
                ['5', true, undefined],
                ['1', false, {
                    message: '"value" failed custom validation because nope',
                    path: [],
                    type: 'any.custom',
                    context: { label: 'value', value: '1', error }
                }],
                ['4', false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { label: 'value', value: '4' }
                }]
            ])
        })

        it('errors on invalid arguments', () => {

            const method = () => null
            expect(() => Engine.any().custom({})).to.throw('Method must be a function')
            expect(() => Engine.any().custom(method)).to.not.throw()
            expect(() => Engine.any().custom(method, '')).to.throw('Description must be a non-empty string')
            expect(() => Engine.any().custom(method, 0)).to.throw('Description must be a non-empty string')
            expect(() => Engine.any().custom(method, [])).to.throw('Description must be a non-empty string')
        })
    })

    describe('messages()', () => {

        it('aliases preferences', () => {

            const messages = {
                english: {
                    value: 'it'
                }
            }

            Helper.equal(Engine.string().valid('x').messages(messages), Engine.string().valid('x').prefs({ messages }))
        })
    })

    describe('shared()', () => {

        it('errors on missing id', () => {

            expect(() => Engine.any().shared(Engine.number())).to.throw('Schema must be a schema with an id')
            expect(() => Engine.any().shared(1)).to.throw('Schema must be a schema with an id')
        })
    })

    describe('warning()', () => {

        it('errors on invalid code', () => {

            expect(() => Engine.any().warning()).to.throw('Invalid warning code')
            expect(() => Engine.any().warning(123)).to.throw('Invalid warning code')
        })
    })
})
