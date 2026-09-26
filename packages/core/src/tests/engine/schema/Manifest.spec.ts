/**
 * Ported from joi/test/manifest.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
import * as Helper from './Helper.js'
const internals = {}

describe('Manifest', () => {

    describe('describe()', () => {

        it('describes schema (direct)', () => {

            const defaultFn = function () {

                return 'test'
            }

            defaultFn.description = 'testing'

            const defaultDescribedFn = function () {

                return 'test'
            }

            const defaultRef = Engine.ref('xor')

            const schema = Engine.object({
                sub: {
                    email: Engine.string().email(),
                    domain: Engine.string().domain(),
                    date: Engine.date(),
                    child: Engine.object({
                        alphanum: Engine.string().alphanum()
                    })
                },
                min: [Engine.number(), Engine.string().min(3)],
                max: Engine.string().max(3).default(0).failover(1),
                required: Engine.string().required(),
                xor: Engine.string(),
                renamed: Engine.string().valid('456'),
                notEmpty: Engine.string().required().description('a').note('b').tag('c'),
                empty: Engine.string().empty('').strip(),
                defaultRef: Engine.string().default(defaultRef),
                defaultFn: Engine.string().default(defaultFn),
                defaultDescribedFn: Engine.string().default(defaultDescribedFn),
                defaultArray: Engine.array().default(['x'])
            })
                .prefs({ abortEarly: false, convert: false })
                .rename('renamed', 'required')
                .without('required', 'xor')
                .without('xor', 'required')
                .allow({ a: 'x' })
                .meta({ x: 1 })

            const result = {
                type: 'object',
                allow: [{ value: { a: 'x' } }],
                keys: {
                    sub: {
                        type: 'object',
                        keys: {
                            email: {
                                type: 'string',
                                rules: [{ name: 'email' }]
                            },
                            domain: {
                                type: 'string',
                                rules: [{ name: 'domain' }]
                            },
                            date: {
                                type: 'date'
                            },
                            child: {
                                type: 'object',
                                keys: {
                                    alphanum: {
                                        type: 'string',
                                        rules: [{ name: 'alphanum' }]
                                    }
                                }
                            }
                        }
                    },
                    min: {
                        type: 'alternatives',
                        matches: [
                            {
                                schema: {
                                    type: 'number'
                                }
                            },
                            {
                                schema: {
                                    type: 'string',
                                    rules: [{ name: 'min', args: { limit: 3 } }]
                                }
                            }
                        ]
                    },
                    max: {
                        type: 'string',
                        flags: {
                            default: 0,
                            failover: 1
                        },
                        rules: [{ name: 'max', args: { limit: 3 } }]
                    },
                    required: {
                        type: 'string',
                        flags: {
                            presence: 'required'
                        }
                    },
                    xor: {
                        type: 'string'
                    },
                    renamed: {
                        type: 'string',
                        flags: {
                            only: true
                        },
                        allow: ['456']
                    },
                    notEmpty: {
                        type: 'string',
                        flags: {
                            description: 'a',
                            presence: 'required'
                        },
                        notes: ['b'],
                        tags: ['c']
                    },
                    empty: {
                        type: 'string',
                        flags: {
                            empty: {
                                type: 'any',
                                flags: {
                                    only: true
                                },
                                allow: ['']
                            },
                            result: 'strip'
                        }
                    },
                    defaultRef: {
                        type: 'string',
                        flags: {
                            default: {
                                ref: { path: ['xor'] }
                            }
                        }
                    },
                    defaultFn: {
                        type: 'string',
                        flags: {
                            default: defaultFn
                        }
                    },
                    defaultDescribedFn: {
                        type: 'string',
                        flags: {
                            default: defaultDescribedFn
                        }
                    },
                    defaultArray: {
                        type: 'array',
                        flags: {
                            default: ['x']
                        }
                    }
                },
                dependencies: [
                    {
                        rel: 'without',
                        key: 'required',
                        peers: ['xor']
                    },
                    {
                        rel: 'without',
                        key: 'xor',
                        peers: ['required']
                    }
                ],
                renames: [
                    {
                        from: 'renamed',
                        to: 'required',
                        options: {
                            alias: false,
                            multiple: false,
                            override: false
                        }
                    }
                ],
                preferences: {
                    abortEarly: false,
                    convert: false
                },
                metas: [{ x: 1 }]
            }

            const description = schema.describe()
            expect(description).to.equal(result)
            expect(description.keys.defaultRef.flags.default).to.equal({ ref: { path: ['xor'] } })
        })

        it('describes schema without invalids', () => {

            const description = Engine.allow(null).describe()
            expect(description.invalids).to.not.exist()
        })

        it('describes value map', () => {

            const symbols = [Symbol(1), Symbol(2)]
            const map = new Map([[1, symbols[0]], ['two', symbols[1]]])
            const schema = Engine.symbol().map(map).describe()
            expect(schema).to.equal({
                type: 'symbol',
                flags: {
                    only: true
                },
                map: [...map.entries()],
                allow: symbols
            })
        })

        it('describes symbol without map', () => {

            const symbols = [Symbol(1), Symbol(2)]
            const schema = Engine.symbol().valid(...symbols).describe()
            expect(schema).to.equal({
                type: 'symbol',
                flags: {
                    only: true
                },
                allow: symbols
            })
        })

        it('handles empty values', () => {

            expect(Engine.allow(1).invalid(1).describe()).to.equal({ type: 'any', invalid: [1] })
            expect(Engine.invalid(1).allow(1).describe()).to.equal({ type: 'any', allow: [1] })
        })

        it('describes ruleset changes', () => {

            const schema = Engine.string().min(1).keep()
            expect(schema.describe()).to.equal({
                type: 'string',
                rules: [
                    {
                        name: 'min',
                        keep: true,
                        args: { limit: 1 }
                    }
                ]
            })
        })

        it('describes defaults', () => {

            const schema = Engine.object({
                foo: Engine.string().default('bar')
            })
                .default({ foo: 'bar' })

            expect(schema.describe()).to.equal({
                type: 'object',
                flags: { default: { foo: 'bar' } },
                keys: { foo: { type: 'string', flags: { default: 'bar' } } }
            })
        })

        it('describes null defaults', () => {

            const description = Engine.any().allow(null).default(null).describe()
            expect(description.invalids).to.not.exist()
        })
    })

    describe('build()', () => {

        it('builds basic schemas', () => {

            internals.test([
                Engine.any(),
                Engine.array(),
                Engine.binary(),
                Engine.boolean(),
                Engine.date(),
                Engine.function(),
                Engine.number(),
                Engine.object(),
                Engine.string(),
                Engine.symbol()
            ])
        })

        it('sets flags', () => {

            internals.test([
                Engine.string().required(),
                Engine.function().default(() => null, { literal: true }),
                Engine.object().default(),
                Engine.array().default(['x']),
                Engine.boolean().optional(),
                Engine.string().empty(''),
                Engine.binary().strip(),
                Engine.alternatives().raw(),
                Engine.any().result('raw')
            ])
        })

        it('sets preferences', () => {

            internals.test([
                Engine.object().prefs({ abortEarly: true }),
                Engine.string().min(10).prefs({ messages: { 'string.min': Engine.x('{$x}') } }),
                Engine.string().min(10).prefs({ messages: { 'string.min': Engine.x('{@x}', { prefix: { context: '@' } }) } })
            ])
        })

        it('sets allow and invalid', () => {

            internals.test([
                Engine.string().allow(1, 2, 3),
                Engine.string().valid(Engine.ref('$x')),
                Engine.number().invalid(1),
                Engine.object().allow({ x: 1 }),
                Engine.allow(null),
                Engine.string().empty('').allow(null)
            ])
        })

        it('sets rules', () => {

            internals.test([
                Engine.string().lowercase(),
                Engine.string().alphanum(),
                Engine.string().min(10),
                Engine.string().length(10, 'binary')
            ])
        })

        it('sets ruleset options', () => {

            internals.test([
                Engine.string().min(1).keep(),
                Engine.string().$.min(1).max(2).rule({ message: 'override' }),
                Engine.string().$.min(1).max(2).rule({ message: Engine.x('{$x}') })
            ])
        })

        it('sets any terms', () => {

            internals.test([
                Engine.string().example('text').tag('a').note('ok then').meta(123),
                Engine.binary().external((v) => v, 'custom'),
                Engine.number().alter({ x: (s) => s.min(1) })
            ])
        })

        it('builds alternatives', () => {

            internals.test([
                Engine.alternatives().try(Engine.boolean()),
                Engine.alternatives(Engine.boolean(), Engine.object({ p: Engine.number() })),
                Engine.alternatives(Engine.object()).error(new Error())
            ])
        })

        it('builds whens', () => {

            internals.test([
                Engine.number().when('$x', { is: true, then: Engine.required(), otherwise: Engine.forbidden() }),
                Engine.number().when(Engine.valid('x'), { then: Engine.required(), otherwise: Engine.forbidden() }),
                Engine.when('$x', { is: true, then: Engine.string() }),
                Engine.number().when('a', { switch: [{ is: 0, then: Engine.valid(1) }], otherwise: Engine.valid(4) })
            ])
        })

        it('builds arrays', () => {

            internals.test([
                Engine.array().min(1).items(Engine.number()),
                Engine.array().has(Engine.string()),
                Engine.array().ordered(Engine.number(), Engine.boolean(), Engine.binary()),
                Engine.array().items(Engine.number()).has(Engine.number()),
                Engine.array().sparse().unique()
            ])
        })

        it('builds binaries', () => {

            internals.test([
                Engine.binary().default(Buffer.from('abcde')).allow(Buffer.from('123'))
            ])
        })

        it('builds booleans', () => {

            internals.test([
                Engine.boolean().truthy('x'),
                Engine.boolean().falsy(Engine.ref('$x')),
                Engine.boolean().truthy(3).falsy(4),
                Engine.boolean().sensitive(),
                Engine.boolean().sensitive(false)
            ])
        })

        it('builds dates', () => {

            internals.test([
                Engine.date().min('1-1-2000 UTC')
            ])
        })

        it('builds links', () => {

            expect(() => Engine.build(Engine.link().describe())).to.throw('Invalid link description missing link')
            internals.test([
                Engine.link('....'),
                Engine.link(Engine.ref('xxx....', { separator: 'x' })),
                Engine.link('/'),
                Engine.link('..a').relative()
            ])
        })

        it('builds objects', () => {

            internals.test([
                Engine.object({}),
                Engine.object({ p: Engine.number() }),
                Engine.object({ a: Engine.string(), b: Engine.number() }),
                Engine.object().rename('a', 'b'),
                Engine.object().rename(/a/, 'b'),
                Engine.object().rename(/(a)/, Engine.x('x{#1}')),
                Engine.object().and('a', 'b').or('c', 'd').without('e', 'f').xor('g.h', 'i', { separator: false }),
                Engine.object().pattern(/x/, Engine.number()),
                Engine.object().pattern(Engine.string(), Engine.number()),
                Engine.object().pattern(/x/, Engine.number(), { matches: Engine.array().length(Engine.ref('$x')), fallthrough: true }),
                Engine.object({ a: 1 }).concat(Engine.object({ a: 3 })),
                Engine.object().instance(RegExp).default(/x/).allow({}).allow({ x: 1 }),
                Engine.object({ regex: 'b' }),
                Engine.object({ buffer: 'c' }),
                Engine.object({ function: 'd' }),
                Engine.object({ override: 'e' }),
                Engine.object({ ref: 'f' }),
                Engine.object({ special: 'g' }),
                Engine.object({ value: 'h' }),
                Engine.object({ type: 'a' }),
                Engine.object({ type: 'a', regex: 'b', buffer: 'c', function: 'd', override: 'e', ref: 'f', special: 'g', value: 'f' })
            ])
        })

        it('builds strings', () => {

            internals.test([
                Engine.string().min(1).max(10).pattern(/\d*/),
                Engine.string().replace(/x/, 'X')
            ])
        })

        it('builds strings', () => {

            internals.test([
                Engine.string().min(1).max(10).pattern(/\d*/),
                Engine.string().replace(/x/, 'X')
            ])
        })

        it('builds symbols', () => {

            internals.test([
                Engine.symbol().map([['a', Symbol('a')]])
            ])
        })

        it('builds references', () => {

            internals.test([
                Engine.allow(Engine.ref('a'))
            ])
        })

        it('builds extended schema (nested builds)', () => {

            const custom = Engine.extend({
                type: 'fancy',
                base: Engine.object({ a: Engine.number() }),
                flags: {
                    presence: {}                                // For coverage
                },
                terms: {
                    fancy: { init: [] }
                },
                rules: {
                    pants: {
                        method(button) {

                            this.$_terms.fancy.push(button)
                            return this
                        }
                    }
                },
                manifest: {

                    build(obj, desc) {

                        if (desc.fancy) {
                            obj = obj.clone()
                            obj.$_terms.fancy = desc.fancy.slice()
                        }

                        return obj
                    }
                }
            })

            const schema = custom.fancy().pants('green').required()
            const desc = schema.describe()

            expect(desc).to.equal({
                type: 'fancy',
                flags: {
                    presence: 'required'
                },
                keys: {
                    a: { type: 'number' }
                },
                fancy: ['green']
            })

            const built = custom.build(desc)
            Helper.equal(built, schema)
        })

        it('builds extended schema (complex)', () => {

            const custom = Engine.extend({
                type: 'million',
                base: Engine.number(),
                flags: {
                    sizable: { setter: 'big' }
                },
                messages: {
                    'million.base': '{{#label}} must be at least a million',
                    'million.big': '{{#label}} must be at least five millions',
                    'million.round': '{{#label}} must be a round number',
                    'million.dividable': '{{#label}} must be dividable by {{#q}}'
                },
                coerce(value, { schema }) {

                    // Only called when prefs.convert is true

                    if (schema.$_getRule('round')) {
                        return { value: Math.round(value) }
                    }
                },
                validate(value, { schema, error }) {

                    // Base validation regardless of the rules applied

                    if (value < 1000000) {
                        return { value, errors: error('million.base') }
                    }

                    // Check flags for global state

                    if (schema.$_getFlag('sizable') &&
                        value < 5000000) {

                        return { value, errors: error('million.big') }
                    }
                },
                rules: {
                    big: {
                        alias: 'large',
                        method() {

                            return this.$_setFlag('sizable', true)
                        }
                    },
                    round: {
                        convert: true,              // Dual rule: converts or validates
                        method() {

                            return this.$_addRule('round')
                        },
                        validate(value, helpers, args, options) {

                            // Only called when prefs.convert is false (due to rule convert option)

                            if (value % 1 !== 0) {
                                return helpers.error('million.round')
                            }
                        }
                    },
                    dividable: {
                        multi: true,                // Rule supports multiple invocations
                        method(q) {

                            return this.$_addRule({ name: 'dividable', args: { q } })
                        },
                        args: [
                            {
                                name: 'q',
                                ref: true,
                                assert: (value) => typeof value === 'number' && !isNaN(value),
                                message: 'q must be a number or reference'
                            }
                        ],
                        validate(value, helpers, args, options) {

                            if (value % args.q === 0) {
                                return value       // Value is valid
                            }

                            return helpers.error('million.dividable', { q: args.q })
                        }
                    },
                    even: {
                        method() {

                            // Rule with only method used to alias another rule

                            return this.dividable(2)
                        }
                    }
                }
            })

            const schema = custom.object({
                a: custom.million().round().dividable(Engine.ref('b')),
                b: custom.number(),
                c: custom.million().even().dividable(7),
                d: custom.million().round().prefs({ convert: false }),
                e: custom.million().large()
            })

            const desc = schema.describe()
            expect(desc).to.equal({
                type: 'object',
                keys: {
                    b: {
                        type: 'number'
                    },
                    a: {
                        type: 'million',
                        rules: [
                            { name: 'round' },
                            {
                                name: 'dividable',
                                args: { q: { ref: { path: ['b'] } } }
                            }
                        ]
                    },
                    c: {
                        type: 'million',
                        rules: [
                            { name: 'dividable', args: { q: 2 } },
                            { name: 'dividable', args: { q: 7 } }
                        ]
                    },
                    d: {
                        type: 'million',
                        rules: [
                            { name: 'round' }
                        ],
                        preferences: {
                            convert: false
                        }
                    },
                    e: {
                        type: 'million',
                        flags: {
                            sizable: true
                        }
                    }
                }
            })

            const built = custom.build(desc)
            Helper.equal(built, schema)
        })

        it('builds extended schema (base with terms)', () => {

            const custom = Engine.extend({
                type: 'fancy',
                base: Engine.array().items(Engine.string().required())
            })

            const schema = custom.fancy()
            const desc = schema.describe()

            expect(desc).to.equal({
                type: 'fancy',
                items: [
                    {
                        flags: { presence: 'required' },
                        type: 'string'
                    }
                ]
            })

            const built = custom.build(desc)
            Helper.equal(built, schema)

            Helper.validate(built, [
                [[1], false, '"[0]" must be a string'],
                [['x'], true]
            ])
        })
    })
})

internals.test = function (schemas) {

    for (const schema of schemas) {
        const built = Engine.build(schema.describe())
        Helper.equal(built, schema)
    }
}
