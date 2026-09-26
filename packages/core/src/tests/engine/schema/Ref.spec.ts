/**
 * Ported from joi/test/ref.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
import * as Helper from './Helper.js'
const internals = {}

describe('ref', () => {

    it('detects references', () => {

        expect(Engine.isRef(Engine.ref('a.b'))).to.be.true()
    })

    it('throws when reference reaches beyond the schema root', () => {

        const schema = Engine.object({
            a: Engine.any(),
            b: Engine.ref('...c')
        })

        expect(() => schema.validate({ a: 1, b: 2 })).to.throw('Invalid reference exceeds the schema root: ref:...c')
    })

    it('reaches self', () => {

        const schema = Engine.number().min(10).message('{#label} is {[.]} and that is not good enough')
        Helper.validate(schema, [[1, false, '"value" is 1 and that is not good enough']])
    })

    it('reaches own property', () => {

        const schema = Engine.object({
            x: Engine.alternatives([
                Engine.number(),
                Engine.object({
                    a: Engine.boolean().required()
                })
                    .when('.a', {
                        is: true,
                        then: {
                            b: Engine.string().required()
                        }
                    })
            ])
        })

        Helper.validate(schema, [
            [{ x: 1 }, true],
            [{ x: { a: true, b: 'x' } }, true]
        ])
    })

    it('reaches parent', () => {

        const schema = Engine.object({
            a: Engine.any(),
            a1: Engine.ref('a'),
            a2: Engine.ref('..a')
        })

        Helper.validate(schema, [
            [
                {
                    a: 1,
                    a1: 1,
                    a2: 1
                }, true
            ]
        ])
    })

    it('reaches grandparent', () => {

        const schema = Engine.object({
            a: Engine.any(),
            b: {
                a1: Engine.ref('...a'),
                a2: Engine.ref('...a')
            }
        })

        Helper.validate(schema, [
            [
                {
                    a: 1,
                    b: {
                        a1: 1,
                        a2: 1
                    }
                }, true
            ]
        ])

        expect(schema.describe()).to.equal({
            type: 'object',
            keys: {
                a: {
                    type: 'any'
                },
                b: {
                    type: 'object',
                    keys: {
                        a1: {
                            flags: {
                                only: true
                            },
                            type: 'any',
                            allow: [{ override: true }, { ref: { ancestor: 2, path: ['a'] } }]
                        },
                        a2: {
                            flags: {
                                only: true
                            },
                            type: 'any',
                            allow: [{ override: true }, { ref: { ancestor: 2, path: ['a'] } }]
                        }
                    }
                }
            }
        })
    })

    it('reaches literal', () => {

        const schema = Engine.object({
            a: Engine.any(),
            b: {
                '...a': Engine.any(),
                c: Engine.ref('...a', { separator: false })
            }
        })

        Helper.validate(schema, [
            [
                {
                    a: 1,
                    b: {
                        '...a': 2,
                        c: 2
                    }
                }, true
            ]
        ])

        expect(schema.describe()).to.equal({
            type: 'object',
            keys: {
                a: {
                    type: 'any'
                },
                b: {
                    type: 'object',
                    keys: {
                        '...a': {
                            type: 'any'
                        },
                        c: {
                            flags: {
                                only: true
                            },
                            type: 'any',
                            allow: [{ override: true }, { ref: { path: ['...a'], separator: false } }]
                        }
                    }
                }
            }
        })
    })

    it('reaches ancestor literal', () => {

        const schema = Engine.object({
            a: Engine.any(),
            '...a': Engine.any(),
            b: {
                '...a': Engine.any(),
                c: Engine.ref('...a', { separator: false, ancestor: 2 })
            }
        })

        Helper.validate(schema, [
            [
                {
                    a: 1,
                    '...a': 3,
                    b: {
                        '...a': 2,
                        c: 3
                    }
                }, true
            ]
        ])
    })

    it('reaches any level of the relative value structure', () => {

        const ix = Engine.ref('...i')

        const schema = Engine.object({
            a: {
                b: {
                    c: {
                        d: Engine.any()
                    },
                    e: 2,
                    dx: Engine.ref('c.d'),
                    ex: Engine.ref('..e'),
                    ix,
                    gx: Engine.ref('....f.g'),
                    hx: Engine.ref('....h')
                },
                i: Engine.any()
            },
            f: {
                g: Engine.any()
            },
            h: Engine.any()
        })

        Helper.validate(schema, [
            [
                {
                    a: {
                        b: {
                            c: {
                                d: 1
                            },
                            e: 2,
                            dx: 1,
                            ex: 2,
                            gx: 3,
                            hx: 4,
                            ix: 5
                        },
                        i: 5
                    },
                    f: {
                        g: 3
                    },
                    h: 4
                }, true
            ],
            [
                {
                    a: {
                        b: {
                            c: {
                                d: 1
                            },
                            e: 2,
                            dx: 1,
                            ex: 2,
                            gx: 3,
                            hx: 4,
                            ix: 5
                        },
                        i: 10
                    },
                    f: {
                        g: 3
                    },
                    h: 4
                }, false, {
                    message: '"a.b.ix" must be [ref:...i]',
                    path: ['a', 'b', 'ix'],
                    type: 'any.only',
                    context: {
                        value: 5,
                        valids: [ix],
                        key: 'ix',
                        label: 'a.b.ix'
                    }
                }
            ]
        ])
    })

    it('reaches any level of the relative value structure (ancestor option)', () => {

        const ix = Engine.ref('i', { ancestor: 2 })

        const schema = Engine.object({
            a: {
                b: {
                    c: {
                        d: Engine.any()
                    },
                    e: 2,
                    dx: Engine.ref('c.d', { ancestor: 1 }),
                    ex: Engine.ref('e', { ancestor: 1 }),
                    ix,
                    gx: Engine.ref('f.g', { ancestor: 3 }),
                    hx: Engine.ref('h', { ancestor: 3 })
                },
                i: Engine.any()
            },
            f: {
                g: Engine.any()
            },
            h: Engine.any()
        })

        Helper.validate(schema, [
            [
                {
                    a: {
                        b: {
                            c: {
                                d: 1
                            },
                            e: 2,
                            dx: 1,
                            ex: 2,
                            gx: 3,
                            hx: 4,
                            ix: 5
                        },
                        i: 5
                    },
                    f: {
                        g: 3
                    },
                    h: 4
                }, true
            ],
            [
                {
                    a: {
                        b: {
                            c: {
                                d: 1
                            },
                            e: 2,
                            dx: 1,
                            ex: 2,
                            gx: 3,
                            hx: 4,
                            ix: 5
                        },
                        i: 10
                    },
                    f: {
                        g: 3
                    },
                    h: 4
                }, false, {
                    message: '"a.b.ix" must be [ref:...i]',
                    path: ['a', 'b', 'ix'],
                    type: 'any.only',
                    context: {
                        value: 5,
                        valids: [ix],
                        key: 'ix',
                        label: 'a.b.ix'
                    }
                }
            ]
        ])
    })

    it('reaches own key value', () => {

        const object = Engine.object().schema('object')
        const schema = Engine.object({
            key: Engine.object().when('.', {
                is: Engine.object().schema(),
                then: object,
                otherwise: Engine.object().pattern(/.*/, object)
            })
                .required()
        })

        Helper.validate(schema, [
            [{ key: object }, true],
            [{ key: 1 }, false, {
                message: '"key" must be of type object',
                type: 'object.base',
                path: ['key'],
                context: {
                    key: 'key',
                    label: 'key',
                    value: 1,
                    type: 'object'
                }
            }],
            [{ key: Engine.number() }, false, {
                message: '"key" must be a schema of object type',
                type: 'object.schema',
                path: ['key'],
                context: {
                    key: 'key',
                    label: 'key',
                    type: 'object',
                    value: Engine.number()
                }
            }],
            [{ key: { a: 1 } }, false, {
                message: '"key.a" must be of type object',
                type: 'object.base',
                path: ['key', 'a'],
                context: {
                    key: 'a',
                    label: 'key.a',
                    value: 1,
                    type: 'object'
                }
            }],
            [{ key: { a: {} } }, false, {
                message: '"key.a" must be a schema of object type',
                type: 'object.schema',
                path: ['key', 'a'],
                context: {
                    key: 'a',
                    label: 'key.a',
                    type: 'object',
                    value: {}
                }
            }]
        ])
    })

    it('reaches into set and map', () => {

        const schema = Engine.object({
            a: {
                b: Engine.array()
                    .items({
                        x: Engine.number(),
                        y: Engine.object().cast('map')
                    })
                    .cast('set')
            },
            d: Engine.ref('a.b.2.y.w', { iterables: true })
        })

        const value = {
            a: {
                b: [
                    { x: 1 },
                    { x: 2 },
                    {
                        y: {
                            v: 4,
                            w: 5
                        }
                    }
                ]
            },
            d: 5
        }

        Helper.validate(schema, [[value, true, {
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
            },
            d: 5
        }]])

        value.d = 6
        Helper.validate(schema, [[value, false, '"d" must be [ref:a.b.2.y.w]']])
    })

    it('reaches root', () => {

        const schema = Engine.object({
            a: Engine.any(),
            b: {
                c: Engine.ref('/a'),
                d: Engine.ref('@a', { prefix: { root: '@' } })
            }
        })

        Helper.validate(schema, [
            [{ a: 1, b: { c: 1, d: 1 } }, true]
        ])

        expect(schema.describe()).to.equal({
            type: 'object',
            keys: {
                a: {
                    type: 'any'
                },
                b: {
                    type: 'object',
                    keys: {
                        c: {
                            flags: {
                                only: true
                            },
                            type: 'any',
                            allow: [{ override: true }, { ref: { ancestor: 'root', path: ['a'] } }]
                        },
                        d: {
                            flags: {
                                only: true
                            },
                            type: 'any',
                            allow: [{ override: true }, { ref: { ancestor: 'root', path: ['a'] } }]
                        }
                    }
                }
            }
        })
    })

    it('errors on missing iterables flag when reaching into set and map', () => {

        const schema = Engine.object({
            a: {
                b: Engine.array()
                    .items({
                        x: Engine.number(),
                        y: Engine.object().cast('map')
                    })
                    .cast('set')
            },
            d: Engine.ref('a.b.2.y.w')
        })

        const value = {
            a: {
                b: [
                    { x: 1 },
                    { x: 2 },
                    {
                        y: {
                            v: 4,
                            w: 5
                        }
                    }
                ]
            },
            d: 5
        }

        Helper.validate(schema, [[value, false, '"d" must be [ref:a.b.2.y.w]']])
    })

    it('errors on invalid separator)', () => {

        expect(() => Engine.ref('x', { separator: 0 })).to.throw('Invalid separator')
        expect(() => Engine.ref('x', { separator: '' })).to.throw('Invalid separator')
        expect(() => Engine.ref('x', { separator: '$$' })).to.throw('Invalid separator')
    })

    it('errors on prefix + ancestor option)', () => {

        expect(() => Engine.ref('..x', { ancestor: 0 })).to.throw('Cannot combine prefix with ancestor option')
    })

    it('errors on root with ancestor prefix', () => {

        expect(() => Engine.ref('/.x')).to.throw('Cannot specify relative path with root prefix')
        expect(() => Engine.ref('/.x', { separator: false })).to.not.throw()
    })

    it('errors on ancestor circular dependency', () => {

        const schema = {
            a: {
                x: Engine.any(),
                b: {
                    c: {
                        d: Engine.ref('....b.x')
                    }
                }
            },
            b: {
                x: Engine.any(),
                y: {
                    z: {
                        o: Engine.ref('....a.x')
                    }
                }
            }
        }

        expect(() => Engine.compile(schema)).to.throw('Item cannot come after itself: b (a.b)')
    })

    it('references array length', () => {

        const ref = Engine.ref('length')
        const schema = Engine.object({
            x: Engine.array().items(Engine.number().valid(ref))
        })

        Helper.validate(schema, [
            [{ x: [1] }, true],
            [{ x: [2, 2] }, true],
            [{ x: [2, 2, 2] }, false, {
                message: '"x[0]" must be [ref:length]',
                path: ['x', 0],
                type: 'any.only',
                context: {
                    value: 2,
                    valids: [ref],
                    key: 0,
                    label: 'x[0]'
                }
            }]
        ])
    })

    it('splits when based on own array length', () => {

        const pair = Engine.array().items(2)
        const lucky = Engine.array().items(7)

        const schema = Engine.object({
            x: Engine.array().when('.length', { is: 2, then: pair, otherwise: lucky })
        })

        Helper.validate(schema, [
            [{ x: [7] }, true],
            [{ x: [7, 7, 7] }, true],
            [{ x: [2, 2] }, true],
            [{ x: [2, 2, 2] }, false, {
                message: '"x[0]" must be [7]',
                path: ['x', 0],
                type: 'any.only',
                context: { value: 2, valids: [7], key: 0, label: 'x[0]' }
            }]
        ])
    })

    it('references array item', () => {

        const ref = Engine.ref('0')
        const schema = Engine.array().ordered(Engine.number(), Engine.number().min(ref))

        Helper.validate(schema, [
            [[1, 2], true],
            [[10, 20], true],
            [[10, 5], false, {
                message: '"[1]" must be greater than or equal to ref:0',
                path: [1],
                type: 'number.min',
                context: { limit: ref, value: 5, key: 1, label: '[1]' }
            }]
        ])
    })

    it('references object own child', () => {

        const ref = Engine.ref('.length')
        const schema = Engine.object({
            length: Engine.number().required()
        })
            .length(ref)
            .unknown()

        expect(schema._refs.refs).to.equal([])     // Does not register reference to itself

        Helper.validate(schema, [
            [{ length: 1 }, true],
            [{ length: 2, x: 3 }, true],
            [{ length: 2, x: 3, y: 4 }, false, {
                message: '"value" must have ref:.length keys',
                path: [],
                type: 'object.length',
                context: {
                    value: { length: 2, x: 3, y: 4 },
                    limit: ref,
                    label: 'value'
                }
            }]
        ])
    })

    it('uses ref as a valid value', () => {

        const ref = Engine.ref('b')
        const schema = Engine.object({
            a: ref,
            b: Engine.any()
        })

        Helper.validate(schema, [[{ a: 5, b: 6 }, false, {
            message: '"a" must be [ref:b]',
            path: ['a'],
            type: 'any.only',
            context: { value: 5, valids: [ref], label: 'a', key: 'a' }
        }]])

        Helper.validate(schema, [
            [{ a: 5 }, false, {
                message: '"a" must be [ref:b]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ b: 5 }, true],
            [{ a: 5, b: 5 }, true],
            [{ a: '5', b: '5' }, true]
        ])
    })

    it('sets adjust function', () => {

        const adjust = (v) => 2 * v
        const ref = Engine.ref('b', { adjust })
        const schema = Engine.object({
            a: ref,
            b: Engine.number()
        })

        Helper.validate(schema, [
            [{ b: 5 }, true],
            [{ a: 10, b: 5 }, true],
            [{ a: 10, b: '5' }, true, { a: 10, b: 5 }],
            [{ a: 5 }, false, {
                message: '"a" must be [ref:b]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ a: 5, b: 5 }, false, {
                message: '"a" must be [ref:b]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }]
        ])

        expect(schema.describe()).to.equal({
            type: 'object',
            keys: {
                b: {
                    type: 'number'
                },
                a: {
                    type: 'any',
                    flags: { only: true },
                    allow: [{ override: true }, { ref: { path: ['b'], adjust } }]
                }
            }
        })
    })

    it('sets map', () => {

        const map = [[5, 10]]
        const ref = Engine.ref('b', { map })
        const schema = Engine.object({
            a: ref,
            b: Engine.number()
        })

        Helper.validate(schema, [
            [{ b: 5 }, true],
            [{ a: 10, b: 5 }, true],
            [{ a: 10, b: '5' }, true, { a: 10, b: 5 }],
            [{ a: 5 }, false, {
                message: '"a" must be [ref:b]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ a: 5, b: 5 }, false, {
                message: '"a" must be [ref:b]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }]
        ])

        expect(schema.describe()).to.equal({
            type: 'object',
            keys: {
                b: {
                    type: 'number'
                },
                a: {
                    type: 'any',
                    flags: { only: true },
                    allow: [{ override: true }, { ref: { path: ['b'], map } }]
                }
            }
        })
    })

    it('uses ref as a valid value (empty key)', () => {

        const ref = Engine.ref('')
        const schema = Engine.object({
            a: ref,
            '': Engine.any()
        })

        Helper.validate(schema, [
            [{ a: 5, '': 6 }, false, {
                message: '"a" must be [ref:..]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ a: 5 }, false, {
                message: '"a" must be [ref:..]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ '': 5 }, true],
            [{ a: 5, '': 5 }, true],
            [{ a: '5', '': '5' }, true]
        ])
    })

    it('uses ref with nested keys as a valid value', () => {

        const ref = Engine.ref('b.c')
        const schema = Engine.object({
            a: ref,
            b: {
                c: Engine.any()
            }
        })

        const err = schema.validate({ a: 5, b: { c: 6 } }).error

        expect(err).to.be.an.error('"a" must be [ref:b.c]')
        expect(err.details).to.equal([{
            message: '"a" must be [ref:b.c]',
            path: ['a'],
            type: 'any.only',
            context: { value: 5, valids: [ref], label: 'a', key: 'a' }
        }])

        Helper.validate(schema, [
            [{ a: 5 }, false, {
                message: '"a" must be [ref:b.c]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ b: { c: 5 } }, true],
            [{ a: 5, b: 5 }, false, {
                message: '"b" must be of type object',
                path: ['b'],
                type: 'object.base',
                context: { label: 'b', key: 'b', value: 5, type: 'object' }
            }],
            [{ a: '5', b: { c: '5' } }, true]
        ])
    })

    it('uses ref with combined nested keys in sub child', () => {

        const ref = Engine.ref('b.c')
        expect(ref.root).to.equal('b')

        const schema = Engine.object({
            a: ref,
            b: {
                c: Engine.any()
            }
        })

        const input = { a: 5, b: { c: 5 } }
        Helper.validate(schema, [[input, true]])

        const parent = Engine.object({
            e: schema
        })

        Helper.validate(parent, [[{ e: input }, true]])
    })

    it('uses ref reach options', () => {

        const ref = Engine.ref('b/c', { separator: '/' })
        expect(ref.root).to.equal('b')

        const schema = Engine.object({
            a: ref,
            b: {
                c: Engine.any()
            }
        })

        Helper.validate(schema, [[{ a: 5, b: { c: 5 } }, true]])
    })

    it('ignores the order in which keys are defined', () => {

        const ab = Engine.object({
            a: {
                c: Engine.number()
            },
            b: Engine.ref('a.c')
        })

        Helper.validate(ab, [[{ a: { c: '5' }, b: 5 }, true, { a: { c: 5 }, b: 5 }]])

        const ba = Engine.object({
            b: Engine.ref('a.c'),
            a: {
                c: Engine.number()
            }
        })

        Helper.validate(ba, [[{ a: { c: '5' }, b: 5 }, true, { a: { c: 5 }, b: 5 }]])
    })

    it('uses ref as default value', async () => {

        const schema = Engine.object({
            a: Engine.any().default(Engine.ref('b')),
            b: Engine.any()
        })

        const value = await schema.validateAsync({ b: 6 })
        expect(value).to.equal({ a: 6, b: 6 })
    })

    it('uses ref mixed with normal values', async () => {

        const schema = Engine.object({
            a: Engine.number().valid(1, Engine.ref('b')),
            b: Engine.any()
        })

        expect(await schema.validateAsync({ a: 6, b: 6 })).to.equal({ a: 6, b: 6 })
        expect(await schema.validateAsync({ a: 1, b: 6 })).to.equal({ a: 1, b: 6 })
        Helper.validate(schema, [[{ a: 6, b: 1 }, false, '"a" must be one of [1, ref:b]']])
    })

    it('uses ref as default value regardless of order', async () => {

        const ab = Engine.object({
            a: Engine.any().default(Engine.ref('b')),
            b: Engine.number()
        })

        const value = await ab.validateAsync({ b: '6' })
        expect(value).to.equal({ a: 6, b: 6 })

        const ba = Engine.object({
            b: Engine.number(),
            a: Engine.any().default(Engine.ref('b'))
        })

        const value2 = await ba.validateAsync({ b: '6' })
        expect(value2).to.equal({ a: 6, b: 6 })
    })

    it('ignores the order in which keys are defined with alternatives', () => {

        const ref1 = Engine.ref('a.c')
        const ref2 = Engine.ref('c')
        const a = Engine.object({ c: Engine.number() })
        const b = Engine.alternatives([ref1, ref2])
        const c = Engine.number()

        for (const schema of [{ a, b, c }, { b, a, c }, { b, c, a }, { a, c, b }, { c, a, b }, { c, b, a }]) {
            Helper.validate(Engine.object().keys(schema), [
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
        }
    })

    it('uses context as default value', async () => {

        const schema = Engine.object({
            a: Engine.any().default(Engine.ref('$x')),
            b: Engine.any()
        })

        const value = await schema.validateAsync({ b: 6 }, { context: { x: 22 } })
        expect(value).to.equal({ a: 22, b: 6 })
    })

    it('uses context as default value with custom prefix', async () => {

        const schema = Engine.object({
            a: Engine.any().default(Engine.ref('@x', { prefix: { global: '@' } })),
            b: Engine.any()
        })

        const value = await schema.validateAsync({ b: 6 }, { context: { x: 22 } })
        expect(value).to.equal({ a: 22, b: 6 })
    })

    it('uses context as a valid value', () => {

        const ref = Engine.ref('$x')
        const schema = Engine.object({
            a: ref,
            b: Engine.any()
        })

        Helper.validate(schema, { context: { x: 22 } }, [
            [{ a: 5, b: 6 }, false, {
                message: '"a" must be [ref:global:x]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ a: 5 }, false, {
                message: '"a" must be [ref:global:x]',
                path: ['a'],
                type: 'any.only',
                context: { value: 5, valids: [ref], label: 'a', key: 'a' }
            }],
            [{ a: 22 }, true],
            [{ b: 5 }, true],
            [{ a: 22, b: 5 }, true],
            [{ a: '22', b: '5' }, false, {
                message: '"a" must be [ref:global:x]',
                path: ['a'],
                type: 'any.only',
                context: { value: '22', valids: [ref], label: 'a', key: 'a' }
            }]
        ])
    })

    it('uses context in when condition', () => {

        const schema = Engine.object({
            a: Engine.boolean().when('$x', { is: Engine.exist(), otherwise: Engine.forbidden() })
        })

        Helper.validate(schema, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: true }
            }]
        ])

        Helper.validate(schema, { context: {} }, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: true }
            }]
        ])

        Helper.validate(schema, { context: { x: 1 } }, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" must be a boolean',
                path: ['a'],
                type: 'boolean.base',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, true]
        ])
    })

    it('uses nested context in when condition', () => {

        const schema = Engine.object({
            a: Engine.boolean().when('$x.y', { is: Engine.exist(), otherwise: Engine.forbidden() })
        })

        Helper.validate(schema, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: true }
            }]
        ])

        Helper.validate(schema, { context: {} }, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: true }
            }]
        ])

        Helper.validate(schema, { context: { x: 1 } }, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: true }
            }]
        ])

        Helper.validate(schema, { context: { x: {} } }, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, false, {
                message: '"a" is not allowed',
                path: ['a'],
                type: 'any.unknown',
                context: { label: 'a', key: 'a', value: true }
            }]
        ])

        Helper.validate(schema, { context: { x: { y: 1 } } }, [
            [{}, true],
            [{ a: 'x' }, false, {
                message: '"a" must be a boolean',
                path: ['a'],
                type: 'boolean.base',
                context: { label: 'a', key: 'a', value: 'x' }
            }],
            [{ a: true }, true]
        ])
    })

    it('describes schema with ref', () => {

        const schema = Engine
            .valid(Engine.ref('a.b'))
            .invalid(Engine.ref('$b.c'))
            .default(Engine.ref('a.b'))
            .when('a.b', {
                is: Engine.date().min(Engine.ref('a.b')).max(Engine.ref('a.b')),
                then: Engine.number().min(Engine.ref('a.b')).max(Engine.ref('a.b')).greater(Engine.ref('a.b')).less(Engine.ref('a.b')),
                otherwise: Engine.object({
                    a: Engine.string().min(Engine.ref('b.c')).max(Engine.ref('b.c')).length(Engine.ref('b.c'))
                }).with('a', 'b').without('b', 'c').assert('a.b', Engine.ref('a.b'))
            })

        expect(schema.describe()).to.equal({
            type: 'any',
            flags: { only: true, default: { ref: { path: ['a', 'b'] } } },
            allow: [{ ref: { path: ['a', 'b'] } }],
            invalid: [{ ref: { type: 'global', path: ['b', 'c'] } }],
            whens: [{
                ref: { path: ['a', 'b'] },
                is: {
                    type: 'date',
                    rules: [
                        { name: 'min', args: { date: { ref: { path: ['a', 'b'] } } } },
                        { name: 'max', args: { date: { ref: { path: ['a', 'b'] } } } }
                    ]
                },
                then: {
                    type: 'number',
                    rules: [
                        { name: 'min', args: { limit: { ref: { path: ['a', 'b'] } } } },
                        { name: 'max', args: { limit: { ref: { path: ['a', 'b'] } } } },
                        { name: 'greater', args: { limit: { ref: { path: ['a', 'b'] } } } },
                        { name: 'less', args: { limit: { ref: { path: ['a', 'b'] } } } }
                    ]
                },
                otherwise: {
                    type: 'object',
                    rules: [{
                        name: 'assert',
                        args: {
                            schema: {
                                type: 'any',
                                flags: { only: true },
                                allow: [{ override: true }, { ref: { path: ['a', 'b'] } }]
                            },
                            subject: { ref: { path: ['a', 'b'] } }
                        }
                    }],
                    keys: {
                        a: {
                            type: 'string',
                            rules: [
                                { name: 'min', args: { limit: { ref: { path: ['b', 'c'] } } } },
                                { name: 'max', args: { limit: { ref: { path: ['b', 'c'] } } } },
                                { name: 'length', args: { limit: { ref: { path: ['b', 'c'] } } } }
                            ]
                        }
                    },
                    dependencies: [{
                        rel: 'with',
                        key: 'a',
                        peers: ['b']
                    },
                    {
                        rel: 'without',
                        key: 'b',
                        peers: ['c']
                    }]
                }
            }]
        })
    })

    describe('clone()', () => {

        it('clones reference', () => {

            const ref = Engine.ref('a.b.c')
            const clone = ref.clone()
            expect(ref).to.equal(clone)
            expect(ref).to.not.shallow.equal(clone)
        })
    })

    describe('context()', () => {

        it('ignores global prefix when conflicts with separator', () => {

            expect(Engine.ref('$a$b', { separator: '$' })).to.equal({
                adjust: null,
                in: false,
                iterables: null,
                map: null,
                separator: '$',
                type: 'value',
                ancestor: 0,
                path: ['a', 'b'],
                depth: 2,
                key: 'a$b',
                root: 'a',
                display: 'ref:$a$b'
            })
        })

        it('ignores local prefix when conflicts with separator', () => {

            expect(Engine.ref('#a#b', { separator: '#' })).to.equal({
                adjust: null,
                in: false,
                iterables: null,
                map: null,
                separator: '#',
                type: 'value',
                ancestor: 0,
                path: ['a', 'b'],
                depth: 2,
                key: 'a#b',
                root: 'a',
                display: 'ref:#a#b'
            })
        })
    })

    describe('create()', () => {

        it('throws when key is missing', () => {

            expect(() => Engine.ref(5)).to.throw('Invalid reference key: 5')
        })

        it('finds root with default separator', () => {

            expect(Engine.ref('a.b.c').root).to.equal('a')
        })

        it('finds root with default separator and options', () => {

            expect(Engine.ref('a.b.c', {}).root).to.equal('a')
        })

        it('finds root with custom separator', () => {

            expect(Engine.ref('a+b+c', { separator: '+' }).root).to.equal('a')
        })
    })
})
