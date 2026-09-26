/**
 * Ported from the upstream test/types/boolean.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../../support/Expect.js'
import Engine from '../../../../lib/validation/engine/schema/index.js'
import * as Helper from '../Helper.js'
const internals = {}

describe('boolean', () => {

    it('should throw an exception if arguments were passed.', () => {

        expect(() => Engine.boolean('invalid argument.')).to.throw('The boolean type does not allow arguments')
    })

    it('converts boolean string to a boolean', () => {

        Helper.validate(Engine.boolean(), [
            ['true', true, true],
            ['false', true, false],
            ['TrUe', true, true],
            ['FalSe', true, false]
        ])
    })

    it('converts boolean string with trailing spaces to a boolean', () => {

        Helper.validate(Engine.boolean(), [
            ['true ', true, true],
            ['false ', true, false]
        ])
    })

    it('does not convert boolean string to a boolean in strict mode', () => {

        Helper.validate(Engine.boolean().strict(), [
            ['true', false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 'true' }
            }],
            ['false', false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 'false' }
            }],
            ['TrUe', false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 'TrUe' }
            }],
            ['FalSe', false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 'FalSe' }
            }]
        ])
    })

    it('errors on a number', () => {

        Helper.validate(Engine.boolean(), [
            [1, false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 1 }
            }],
            [0, false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 0 }
            }],
            [2, false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 2 }
            }]
        ])
    })

    it('respects case for allow', () => {

        const schema = Engine.boolean().allow('X')
        Helper.validate(schema, [
            ['X', true],
            ['x', false, '"value" must be a boolean']
        ])
    })

    describe('cast()', () => {

        it('casts value to number', () => {

            const schema = Engine.boolean().cast('number')
            Helper.validate(schema, [
                [true, true, 1],
                [false, true, 0]
            ])
        })

        it('casts value to string', () => {

            const schema = Engine.boolean().cast('string')
            Helper.validate(schema, [
                [true, true, 'true'],
                [false, true, 'false']
            ])
        })

        it('ignores null', () => {

            const schema = Engine.boolean().allow(null).cast('string')
            Helper.validate(schema, [[null, true, null]])
        })

        it('ignores string', () => {

            const schema = Engine.boolean().allow('x').cast('string')
            Helper.validate(schema, [['x', true, 'x']])
        })
    })

    describe('falsy()', () => {

        it('works with additional falsy value', () => {

            const rule = Engine.boolean().falsy('N')
            Helper.validate(rule, [
                ['N', true, false],
                ['Y', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'Y' }
                }],
                [true, true],
                [false, true],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with additional falsy arguments', () => {

            const rule = Engine.boolean().falsy('N', 'Never')
            Helper.validate(rule, [
                ['N', true, false],
                ['Never', true, false],
                ['Y', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'Y' }
                }],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }],
                [true, true],
                [false, true]
            ])
        })

        it('works with additional falsy statements', () => {

            const rule = Engine.boolean().falsy('N').falsy('Never')
            Helper.validate(rule, [
                ['N', true, false],
                ['Never', true, false],
                ['Y', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'Y' }
                }],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }],
                [true, true],
                [false, true]
            ])
        })

        it('errors on falsy without convert', () => {

            const schema = Engine.boolean().falsy('n')
            expect(schema.validate('n', { convert: false }).error).be.an.error('"value" must be a boolean')
        })
    })

    describe('sensitive()', () => {

        it('should default to case insensitive', () => {

            const schema = Engine.boolean().truthy('Y')
            Helper.validate(schema, [['y', true, true]])
        })

        it('should stick to case insensitive if called', () => {

            const schema = Engine.boolean().truthy('Y').sensitive(false)
            expect(schema.validate('y').error).not.to.exist()
        })

        it('should be able to do strict comparison', () => {

            const schema = Engine.boolean().truthy('Y').sensitive()
            Helper.validate(schema, [['y', false, {
                message: '"value" must be a boolean',
                path: [],
                type: 'boolean.base',
                context: { label: 'value', value: 'y' }
            }]])
        })

        it('should return the same instance if nothing changed', () => {

            const insensitiveSchema = Engine.boolean()
            expect(insensitiveSchema.sensitive(false)).to.shallow.equal(insensitiveSchema)
            expect(insensitiveSchema.sensitive()).to.not.shallow.equal(insensitiveSchema)

            const sensitiveSchema = Engine.boolean().sensitive()
            expect(sensitiveSchema.sensitive()).to.shallow.equal(sensitiveSchema)
            expect(sensitiveSchema.sensitive(false)).to.not.shallow.equal(sensitiveSchema)
        })

        it('converts boolean string to a boolean with a sensitive case', () => {

            Helper.validate(Engine.boolean().sensitive(), [
                ['true', true, true],
                ['false', true, false],
                ['TrUe', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'TrUe' }
                }],
                ['FalSe', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'FalSe' }
                }]
            ])
        })

    })

    describe('validate()', () => {

        it('does not convert string values and validates', () => {

            const rule = Engine.boolean()
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, true],
                [true, true],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }],
                ['on', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'on' }
                }],
                ['off', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'off' }
                }],
                ['yes', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'yes' }
                }],
                ['no', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'no' }
                }],
                ['1', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1' }
                }],
                ['0', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '0' }
                }]
            ])
        })

        it('works with required', () => {

            const rule = Engine.boolean().required()
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, true],
                [true, true],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with allow', () => {

            const rule = Engine.boolean().allow(false)
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, true],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with invalid', () => {

            const rule = Engine.boolean().invalid(false)
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: false, invalids: [false], label: 'value' }
                }],
                [true, true],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with invalid and null allowed', () => {

            const rule = Engine.boolean().invalid(false).allow(null)
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: false, invalids: [false], label: 'value' }
                }],
                [true, true],
                [null, true]
            ])
        })

        it('works with allow and invalid', () => {

            const rule = Engine.boolean().invalid(true).allow(false)
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, true],
                [true, false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: true, invalids: [true], label: 'value' }
                }],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with allow, invalid, and null allowed', () => {

            const rule = Engine.boolean().invalid(true).allow(false).allow(null)
            Helper.validate(rule, [
                ['1234', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: '1234' }
                }],
                [false, true],
                [true, false, {
                    message: '"value" contains an invalid value',
                    path: [],
                    type: 'any.invalid',
                    context: { value: true, invalids: [true], label: 'value' }
                }],
                [null, true]
            ])
        })

        it('works with required, null allowed, and both additional truthy and falsy values', () => {

            const rule = Engine.boolean().truthy('Y', 'Si', 1).falsy('N', 'Never', 0).allow(null).required()
            Helper.validate(rule, [
                ['N', true, false],
                ['Never', true, false],
                ['Y', true, true],
                ['y', true, true],
                ['Si', true, true],
                [true, true],
                [false, true],
                [1, true, true],
                [0, true, false],
                [null, true],
                ['M', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'M' }
                }],
                ['Yes', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'Yes' }
                }]
            ])
        })

        it('should handle concatenated schema', () => {

            const a = Engine.boolean().truthy('yes')
            const b = Engine.boolean().falsy('no')

            Helper.validate(a, [
                ['yes', true, true],
                ['no', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'no' }
                }]
            ])

            Helper.validate(b, [
                ['no', true, false],
                ['yes', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'yes' }
                }]
            ])

            Helper.validate(a.concat(b), [
                ['yes', true, true],
                ['no', true, false]
            ])
        })

        it('should describe truthy and falsy values', () => {

            const schema = Engine.boolean().truthy('yes').falsy('no').required().describe()
            expect(schema).to.equal({
                type: 'boolean',
                flags: {
                    presence: 'required'
                },
                truthy: ['yes'],
                falsy: ['no']
            })
        })
    })

    describe('truthy()', () => {

        it('works with additional truthy value', () => {

            const rule = Engine.boolean().truthy('Y')
            Helper.validate(rule, [
                ['Y', true, true],
                [true, true],
                [false, true],
                ['N', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'N' }
                }],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with additional truthy arguments', () => {

            const rule = Engine.boolean().truthy('Y', 'Si')
            Helper.validate(rule, [
                ['Si', true, true],
                ['Y', true, true],
                [true, true],
                [false, true],
                ['N', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'N' }
                }],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('works with multiple truthy arguments', () => {

            const rule = Engine.boolean().truthy('Y').truthy('Si')
            Helper.validate(rule, [
                ['Si', true, true],
                ['Y', true, true],
                [true, true],
                [false, true],
                ['N', false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: 'N' }
                }],
                [null, false, {
                    message: '"value" must be a boolean',
                    path: [],
                    type: 'boolean.base',
                    context: { label: 'value', value: null }
                }]
            ])
        })

        it('errors on truthy without convert', () => {

            const schema = Engine.boolean().truthy('y')
            Helper.validate(schema, { convert: false }, [['y', false, '"value" must be a boolean']])
        })
    })
})
