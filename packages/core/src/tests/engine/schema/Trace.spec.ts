/**
 * Ported from the upstream test/trace.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 * Upstream test logic is kept line by line (only the runner, the imports and the code style differ) so it can be
 * compared with upstream. It deliberately exercises dynamic and invalid inputs, so it is not type-checked.
 */
// @ts-nocheck
import {afterEach, describe, it} from 'node:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
import * as Locator from '../../../lib/validation/engine/location/index.js'
const internals = {}

//Adapted: ESM has no __filename; the tracer records file names from stack frames (file:// URLs in ESM), so the
//expected name comes from the same source
const __filename = Locator.location().filename

//Adapted: upstream expects `Locator.location().line - n`, which relies on the blank lines of the source file (the
//TypeScript compiler drops them); the expected line is looked up in the compiled file instead
const compiledLines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').map((line) => line.trim().replace(/;$/, ''))
const lineOf = (text, occurrence) => {

    let found = -1
    for (let i = 0; i < compiledLines.length; ++i) {
        if (compiledLines[i] === text && found++ === occurrence - 1) {
            return i + 1
        }
    }

    throw new Error(`Line not found in compiled test: ${text}`)
}

describe('Trace', () => {

    describe('trace()', () => {

        afterEach(() => Engine.untrace())

        it('reuses tracer', () => {

            const tracer = Engine.trace()
            expect(Engine.trace()).to.shallow.equal(tracer)
            Engine.untrace()

            expect(Engine.trace()).to.not.shallow.equal(tracer)
        })

        it('tracks rules', () => {

            const tracer = Engine.trace()

            const schema = Engine.string()
                .lowercase()
                .pattern(/\d/)

            schema.validate('a')
            schema.validate('4')

            expect(tracer.report()).to.be.null()
        })

        it('reports coverage', () => {

            const tracer = Engine.trace()

            const schema = Engine.string()
                .lowercase()
                .pattern(/\d/)
                .max(20)
                .min(10)

            schema.validate('123456789012345678901')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate('123456789012345678901')", 0),
                    message: 'Schema missing tests for pattern (always pass), max (always error), min (never used)',
                    missing: [
                        {
                            status: 'always pass',
                            rule: 'pattern'
                        },
                        {
                            status: 'always error',
                            rule: 'max'
                        },
                        {
                            status: 'never used',
                            rule: 'min'
                        }
                    ],
                    severity: 'error'
                }
            ])

            expect(tracer.report('missing')).to.be.null()
        })

        it('reports nested coverage', () => {

            const tracer = Engine.trace()

            const schema = Engine.object({
                a: {
                    x: Engine.string()
                        .lowercase()
                        .pattern(/\d/)
                        .max(20)
                        .min(10)
                },

                b: Engine.number()
                    .min(100)
            })

            schema.validate({ a: { x: '123456789012345678901' }, b: 11 })

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate({ a: { x: '123456789012345678901' }, b: 11 })", 0),
                    severity: 'error',
                    message: 'Schema missing tests for a.x:pattern (always pass), a.x:max (always error), a.x:min (never used), b (never reached)',
                    missing: [
                        {
                            paths: [['a', 'x']],
                            status: 'always pass',
                            rule: 'pattern'
                        },
                        {
                            paths: [['a', 'x']],
                            status: 'always error',
                            rule: 'max'
                        },
                        {
                            paths: [['a', 'x']],
                            status: 'never used',
                            rule: 'min'
                        },
                        {
                            paths: [['b']],
                            status: 'never reached'
                        }
                    ]
                }
            ])
        })

        it('uses schema id', () => {

            const tracer = Engine.trace()

            const schema = Engine.object({
                a: Engine.object({
                    x: Engine.string()
                        .lowercase()
                        .pattern(/\d/)
                        .max(20)
                        .min(10)
                })
                    .id('A'),

                b: Engine.number()
                    .min(100),

                c: Engine.any()
                    .empty(Engine.number().max(10))
            })

            schema.validate({ a: { x: '123456789012345678901' }, b: 11, c: 5 })

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate({ a: { x: '123456789012345678901' }, b: 11, c: 5 })", 0),
                    severity: 'error',
                    message: 'Schema missing tests for A.x:pattern (always pass), A.x:max (always error), A.x:min (never used), b (never reached), c (never reached)',
                    missing: [
                        {
                            paths: [['A', 'x']],
                            status: 'always pass',
                            rule: 'pattern'
                        },
                        {
                            paths: [['A', 'x']],
                            status: 'always error',
                            rule: 'max'
                        },
                        {
                            paths: [['A', 'x']],
                            status: 'never used',
                            rule: 'min'
                        },
                        {
                            paths: [['b']],
                            status: 'never reached'
                        },
                        {
                            paths: [['c']],
                            status: 'never reached'
                        }
                    ]
                }
            ])
        })

        it('handles reused schema', () => {

            const tracer = Engine.trace()

            const key = Engine.any().empty(Engine.number().max(10))
            const schema = Engine.object({
                a: key,
                b: key
            })

            schema.validate({ a: 5, b: 6 })

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate({ a: 5, b: 6 })", 0),
                    message: 'Schema missing tests for a.@empty:max (always pass)',
                    severity: 'error',
                    missing: [
                        {
                            paths: [['a', '@empty'], ['b', '@empty']],
                            rule: 'max',
                            status: 'always pass'
                        }
                    ]
                }
            ])
        })

        it('reports skipped schema without rule', () => {

            const tracer = Engine.trace()

            const schema = Engine.alternatives([
                Engine.string(),
                Engine.number()
            ])

            schema.validate('x')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate('x')", 0),
                    message: 'Schema missing tests for @matches[1] (never reached)',
                    severity: 'error',
                    missing: [
                        {
                            paths: [['@matches', 1]],
                            status: 'never reached'
                        }
                    ]
                }
            ])
        })

        it('reports array items', () => {

            const tracer = Engine.trace()

            const schema = Engine.array().items(Engine.boolean(), Engine.string())

            schema.validate([true])

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate([true])", 0),
                    severity: 'error',
                    message: 'Schema missing tests for items (always pass), @items[1] (never reached)',
                    missing: [
                        {
                            rule: 'items',
                            status: 'always pass'
                        },
                        {
                            paths: [['@items', 1]],
                            status: 'never reached'
                        }
                    ]
                }
            ])
        })

        it('tracks valid and invalid values', () => {

            const tracer = Engine.trace()

            const schema = Engine.string()
                .allow('a', 'b', 'c')
                .deny('x', 'y', 'z')

            schema.validate('a')
            schema.validate('b')
            schema.validate('x')
            schema.validate('y')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate('a')", 1),
                    message: 'Schema missing tests for valids (c), invalids (z)',
                    severity: 'error',
                    missing: [
                        {
                            rule: 'valids',
                            status: ['c']
                        },
                        {
                            rule: 'invalids',
                            status: ['z']
                        }
                    ]
                }
            ])

            schema.validate('c')
            schema.validate('z')

            expect(tracer.report(__filename)).to.be.null()
        })

        it('tracks valid values (refs)', () => {

            const tracer = Engine.trace()

            const schema = Engine.object({
                a: Engine.string(),
                b: Engine.string(),
                c: Engine.string()
                    .allow(Engine.ref('a'), Engine.ref('b'))
            })

            schema.validate({ a: 'a', b: 'b', c: 'a' })

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate({ a: 'a', b: 'b', c: 'a' })", 0),
                    message: 'Schema missing tests for valids (ref:b)',
                    missing: [
                        {
                            rule: 'valids',
                            status: ['ref:b']
                        }
                    ],
                    severity: 'error'
                }
            ])

            schema.validate({ a: 'a', b: 'b', c: 'b' })

            expect(tracer.report(__filename)).to.be.null()
        })

        it('tracks default and failover', () => {

            const tracer = Engine.trace()

            const schema = Engine.string()
                .default('x')
                .failover('y')

            schema.validate('test')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate('test')", 0),
                    message: 'Schema missing tests for default (never used), failover (never used)',
                    missing: [
                        {
                            rule: 'default',
                            status: 'never used'
                        },
                        {
                            rule: 'failover',
                            status: 'never used'
                        }
                    ],
                    severity: 'error'
                }
            ])

            schema.validate()
            schema.validate({})

            expect(tracer.report(__filename)).to.be.null()
        })

        it('reports coverage with manual location', () => {

            const tracer = Engine.trace()

            const schema = Engine.string().tracer()
                .lowercase()
                .pattern(/\d/)
                .max(20)
                .min(10)

            schema.validate('123456789012345678901')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("const schema = Engine.string().tracer()", 0),
                    message: 'Schema missing tests for pattern (always pass), max (always error), min (never used)',
                    missing: [
                        {
                            status: 'always pass',
                            rule: 'pattern'
                        },
                        {
                            status: 'always error',
                            rule: 'max'
                        },
                        {
                            status: 'never used',
                            rule: 'min'
                        }
                    ],
                    severity: 'error'
                }
            ])
        })

        it('reports coverage with manual location (concat override)', () => {

            const tracer = Engine.trace()

            const base = Engine.string().lowercase()
                .pattern(/\d/)
                .tracer()

            const schema = Engine.any().concat(base).tracer()
                .max(20)
                .min(10)

            schema.validate('123456789012345678901')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("const schema = Engine.any().concat(base).tracer()", 0),
                    message: 'Schema missing tests for pattern (always pass), max (always error), min (never used)',
                    missing: [
                        {
                            status: 'always pass',
                            rule: 'pattern'
                        },
                        {
                            status: 'always error',
                            rule: 'max'
                        },
                        {
                            status: 'never used',
                            rule: 'min'
                        }
                    ],
                    severity: 'error'
                }
            ])
        })

        it('reports coverage with manual location (concat)', () => {

            const tracer = Engine.trace()

            const base = Engine.string().lowercase()
                .pattern(/\d/)
                .tracer()

            const schema = Engine.any().concat(base)
                .max(20)
                .min(10)

            schema.validate('123456789012345678901')

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf(".tracer()", 1),
                    message: 'Schema missing tests for pattern (always pass), max (always error), min (never used)',
                    missing: [
                        {
                            status: 'always pass',
                            rule: 'pattern'
                        },
                        {
                            status: 'always error',
                            rule: 'max'
                        },
                        {
                            status: 'never used',
                            rule: 'min'
                        }
                    ],
                    severity: 'error'
                }
            ])
        })

        it('handles when()', () => {

            const tracer = Engine.trace()

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.boolean(),
                c: Engine.string()
                    .when('a', { is: true, then: Engine.string().min(10).allow('y') })
                    .when('b', { is: true, then: Engine.string().max(100) })
            })

            schema.validate({ a: true, b: true, c: 'x' })
            schema.validate({ a: true, b: true, c: 'y' })

            expect(tracer.report(__filename)).to.equal([
                {
                    filename: __filename,
                    line: lineOf("schema.validate({ a: true, b: true, c: 'x' })", 0),
                    message: 'Schema missing tests for c.@whens[0]:min (always error), c.@whens[1]:max (never used)',
                    severity: 'error',
                    missing: [
                        {
                            paths: [['c', '@whens', 0]],
                            rule: 'min',
                            status: 'always error'
                        },
                        {
                            paths: [['c', '@whens', 1]],
                            rule: 'max',
                            status: 'never used'
                        }
                    ]
                }
            ])
        })
    })

    describe('debug', () => {

        it('creates debug log', () => {

            const schema = Engine.object({
                a: {
                    x: Engine.string()
                        .lowercase()
                        .pattern(/\d/)
                        .max(20)
                        .min(10)
                },

                b: Engine.number()
                    .min(100),

                c: Engine.not('y')
            })

            const debug = schema.validate({ a: { x: '12345678901234567890' }, b: 110, c: 'y' }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['a', 'x'] },
                { type: 'rule', name: 'case', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'pattern', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'max', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'min', result: 'pass', path: ['a', 'x'] },
                { type: 'entry', path: ['b'] },
                { type: 'rule', name: 'min', result: 'pass', path: ['b'] },
                { type: 'entry', path: ['c'] },
                { type: 'invalid', value: 'y', path: ['c'] },
                { type: 'resolve', ref: 'ref:local:label', to: 'c', path: ['c'] }
            ])
        })

        it('creates debug log (async)', async () => {

            const schema = Engine.object({
                a: {
                    x: Engine.string()
                        .lowercase()
                        .pattern(/\d/)
                        .max(20)
                        .min(10)
                },

                b: Engine.number()
                    .min(100),

                c: Engine.not('y')
            })

            const err = await expect(schema.validateAsync({ a: { x: '12345678901234567890' }, b: 110, c: 'y' }, { debug: true })).to.reject()
            expect(err.debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['a', 'x'] },
                { type: 'rule', name: 'case', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'pattern', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'max', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'min', result: 'pass', path: ['a', 'x'] },
                { type: 'entry', path: ['b'] },
                { type: 'rule', name: 'min', result: 'pass', path: ['b'] },
                { type: 'entry', path: ['c'] },
                { type: 'invalid', value: 'y', path: ['c'] },
                { type: 'resolve', ref: 'ref:local:label', to: 'c', path: ['c'] }
            ])

            const { debug } = await schema.validateAsync({ a: { x: '12345678901234567890' }, b: 110, c: 'x' }, { debug: true })
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['a', 'x'] },
                { type: 'rule', name: 'case', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'pattern', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'max', result: 'pass', path: ['a', 'x'] },
                { type: 'rule', name: 'min', result: 'pass', path: ['a', 'x'] },
                { type: 'entry', path: ['b'] },
                { type: 'rule', name: 'min', result: 'pass', path: ['b'] },
                { type: 'entry', path: ['c'] }
            ])
        })

        it('logs when forks', () => {

            const schema = Engine.object({
                a: Engine.number(),

                b: Engine.number()
                    .when('a', { is: 1, then: 2, otherwise: 3 })
                    .when('a', { is: 4, then: 5, otherwise: 6 }),       // This conflicts with the first when()

                c: Engine.number()
                    .when('a', [
                        { is: 1, then: 2 },
                        { is: 3, then: 4 }
                    ])
            })

            const debug = schema.validate({ a: 1, b: 6 }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'resolve', ref: 'ref:a', to: 1, path: ['b'] },
                { type: 'entry', path: ['b', '0.is'] },
                { type: 'valid', value: 1, path: ['b', '0.is'] },
                { type: 'resolve', ref: 'ref:a', to: 1, path: ['b'] },
                { type: 'entry', path: ['b', '1.is'] },
                { type: 'rule', name: 'when', result: '0.then, 1.otherwise', path: ['b'] },
                { type: 'entry', path: ['b'] },
                { type: 'valid', value: 6, path: ['b'] },
                { type: 'resolve', ref: 'ref:a', to: 1, path: ['c'] },
                { type: 'entry', path: ['c', '0.0.is'] },
                { type: 'valid', value: 1, path: ['c', '0.0.is'] },
                { type: 'rule', name: 'when', result: '0.0.then', path: ['c'] },
                { type: 'entry', path: ['c'] }
            ])
        })

        it('logs when on sub key', () => {

            const building = Engine.object({
                a: Engine.object({
                    name: Engine.string().cache(),
                    lucky: Engine.string()
                        .when('name', { is: 'thirteen', then: Engine.valid('no') })
                })
            })

            const structure = {
                a: { name: 'first' }
            }

            const debug = building.validate(structure, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'validate', name: 'cached', result: false, path: ['a', 'name'] },
                { type: 'entry', path: ['a', 'name'] },
                { type: 'resolve', ref: 'ref:name', to: 'first', path: ['a', 'lucky'] },
                { type: 'entry', path: ['a', 'lucky', '0.is'] },
                { type: 'rule', name: 'when', result: '', path: ['a', 'lucky'] },
                { type: 'entry', path: ['a', 'lucky'] }
            ])
        })

        it('logs sub when condition (then)', () => {

            const sub = Engine.when('b', { is: true, then: 2, otherwise: 3 })
            const schema = Engine.object({
                a: Engine.boolean().required(),
                b: Engine.boolean().required(),
                c: Engine.number()
                    .when('a', { is: true, then: sub, otherwise: 1 })
            })

            const debug = schema.validate({ a: true, b: true, c: 2 }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['b'] },
                { type: 'resolve', ref: 'ref:a', to: true, path: ['c'] },
                { type: 'entry', path: ['c', '0.is'] },
                { type: 'valid', value: true, path: ['c', '0.is'] },
                { type: 'resolve', ref: 'ref:b', to: true, path: ['c', '0.then'] },
                { type: 'entry', path: ['c', '0.then', '0.is'] },
                { type: 'valid', value: true, path: ['c', '0.then', '0.is'] },
                { type: 'rule', name: 'when', result: '0.then', path: ['c', '0.then'] },
                { type: 'rule', name: 'when', result: '0.then(0.then)', path: ['c'] },
                { type: 'entry', path: ['c'] },
                { type: 'valid', value: 2, path: ['c'] }
            ])
        })

        it('logs sub when condition (otherwise)', () => {

            const sub = Engine.when('b', { is: true, then: 2, otherwise: 3 })
            const schema = Engine.object({
                a: Engine.boolean().required(),
                b: Engine.boolean().required(),
                c: Engine.number()
                    .when('a', { is: true, then: 1, otherwise: sub })
            })

            const debug = schema.validate({ a: false, b: true, c: 2 }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['b'] },
                { type: 'resolve', ref: 'ref:a', to: false, path: ['c'] },
                { type: 'entry', path: ['c', '0.is'] },
                { type: 'resolve', ref: 'ref:b', to: true, path: ['c', '0.otherwise'] },
                { type: 'entry', path: ['c', '0.otherwise', '0.is'] },
                { type: 'valid', value: true, path: ['c', '0.otherwise', '0.is'] },
                { type: 'rule', name: 'when', result: '0.then', path: ['c', '0.otherwise'] },
                { type: 'rule', name: 'when', result: '0.otherwise(0.then)', path: ['c'] },
                { type: 'entry', path: ['c'] },
                { type: 'valid', value: 2, path: ['c'] }
            ])
        })

        it('logs compounded whens', () => {

            const schema = Engine.object({
                a: Engine.string(),
                b: Engine.boolean()
            })
                .when('.a', {
                    is: 'x',
                    then: Engine.object({
                        c: Engine.boolean()
                    })
                })
                .when('.b', {
                    is: true,
                    then: Engine.object({
                        c: Engine.forbidden()
                    })
                })

            const debug = schema.validate({ a: 'x', b: true }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'resolve', ref: 'ref:.a', to: 'x', path: [] },
                { type: 'entry', path: ['0.is'] },
                { type: 'valid', value: 'x', path: ['0.is'] },
                { type: 'resolve', ref: 'ref:.b', to: true, path: [] },
                { type: 'entry', path: ['1.is'] },
                { type: 'valid', value: true, path: ['1.is'] },
                { type: 'rule', name: 'when', result: '0.then, 1.then', path: [] },
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['b'] },
                { type: 'entry', path: ['c'] }
            ])
        })

        it('logs changes in value', () => {

            const schema = Engine.number().raw()

            const debug = schema.validate('123', { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'value', by: 'coerced', from: '123', to: 123, path: [] },
                { type: 'value', by: 'raw', from: 123, to: '123', path: [] }
            ])
        })

        it('logs changes in value (with name)', () => {

            const schema = Engine.number().cast('string')

            const debug = schema.validate('123', { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'value', by: 'coerced', from: '123', to: 123, path: [] },
                { type: 'value', by: 'cast', name: 'string', from: 123, to: '123', path: [] }
            ])
        })

        it('debugs multiple time same schema (link)', () => {

            const schema = Engine.object({
                a: Engine.boolean(),
                b: Engine.link('a')
                    .when('a', { then: Engine.forbidden() })
            })

            const debug1 = schema.validate({ a: true, b: true }, { debug: true }).debug
            expect(debug1).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'resolve', ref: 'ref:a', to: true, path: ['b'] },
                { type: 'entry', path: ['b', '0.is'] },
                { type: 'rule', name: 'when', result: '0.then', path: ['b'] },
                { type: 'entry', path: ['b'] },
                { type: 'resolve', ref: 'ref:local:label', to: 'b', path: ['b'] }
            ])

            const debug2 = schema.validate({ a: false, b: false }, { debug: true }).debug
            expect(debug2).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'resolve', ref: 'ref:a', to: false, path: ['b'] },
                { type: 'entry', path: ['b', '0.is'] },
                { type: 'invalid', value: false, path: ['b', '0.is'] },
                { type: 'rule', name: 'when', result: '', path: ['b'] },
                { type: 'entry', path: ['b'] },
                { type: 'entry', path: ['b', 'link:ref:a:boolean'] }
            ])
        })

        it('debugs multiple time same schema (whens)', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.number()
                    .when('a', { is: 1, then: 2 })
                    .when('a', { is: 2, then: 3 })
            })

            const values = [
                { a: 1, b: 2 },
                { a: 1, b: 3 },
                { a: 2, b: 2 },
                { a: 2, b: 3 }
            ]

            schema.validate({ a: 1, b: 2 })        // No debug

            for (const value of values) {
                schema.validate(value, { debug: true })
            }
        })

        it('debugs multiple time same schema (whens + partial validate)', () => {

            const x = Engine.object({
                a: Engine.number(),
                b: Engine.number()
                    .when('a', { is: 1, then: 2 })
                    .when('a', { is: 2, then: 3 })
            })

            const values = [
                { x: { a: 1, b: 2 } },
                { x: { a: 1, b: 3 } },
                { x: { a: 2, b: 2 } },
                { x: { a: 2, b: 3 } }
            ]

            x.validate({ a: 1, b: 2 })         // No debug

            const schema = Engine.object({ x })

            for (const value of values) {
                schema.validate(value, { debug: true })
            }
        })

        it('debugs multiple time same schema (recursive)', () => {

            const schema = Engine.object({
                a: Engine.number(),
                b: Engine.link('..')
            })

            const debug1 = schema.validate({ a: 1, b: { a: 2 } }, { debug: true }).debug
            expect(debug1).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['b'] },
                { type: 'entry', path: ['b', 'link:ref:..:object'] },
                { type: 'entry', path: ['b', 'a'] },
                { type: 'entry', path: ['b', 'b'] }
            ])

            const debug2 = schema.validate({ a: 1, b: { a: 3, b: { a: 4 } } }, { debug: true }).debug
            expect(debug2).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['a'] },
                { type: 'entry', path: ['b'] },
                { type: 'entry', path: ['b', 'link:ref:..:object'] },
                { type: 'entry', path: ['b', 'a'] },
                { type: 'entry', path: ['b', 'b'] },
                { type: 'entry', path: ['b', 'b', 'link:ref:..:object'] },
                { type: 'entry', path: ['b', 'b', 'a'] },
                { type: 'entry', path: ['b', 'b', 'b'] }
            ])
        })

        it('handles array item exclusions', () => {

            const schema = Engine.array().items(Engine.string().forbidden())

            const debug = schema.validate(['x'], { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: [0] },
                { type: 'rule', name: 'items', result: 'error', path: [] },
                { type: 'resolve', ref: 'ref:local:label', to: '[0]', path: [0] }
            ])
        })

        it('handles recursive links with when', () => {

            const schema = Engine.object({
                must: Engine.boolean().required(),
                child: Engine.link('..')
                    .when('must', { then: Engine.required() })
            })

            const debug = schema.validate({ must: true, child: { must: true, child: { must: false } } }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'entry', path: ['must'] },
                { type: 'resolve', ref: 'ref:must', to: true, path: ['child'] },
                { type: 'entry', path: ['child', '0.is'] },
                { type: 'rule', name: 'when', result: '0.then', path: ['child'] },
                { type: 'entry', path: ['child'] },
                { type: 'entry', path: ['child', 'must'] },
                { type: 'resolve', ref: 'ref:must', to: true, path: ['child', 'child'] },
                { type: 'entry', path: ['child', 'child', '0.is'] },
                { type: 'rule', name: 'when', result: '0.then', path: ['child', 'child'] },
                { type: 'entry', path: ['child', 'child'] },
                { type: 'entry', path: ['child', 'child', 'must'] },
                { type: 'resolve', ref: 'ref:must', to: false, path: ['child', 'child', 'child'] },
                { type: 'entry', path: ['child', 'child', 'child', '0.is'] },
                { type: 'invalid', value: false, path: ['child', 'child', 'child', '0.is'] },
                { type: 'rule', name: 'when', result: '', path: ['child', 'child', 'child'] },
                { type: 'entry', path: ['child', 'child', 'child'] }
            ])
        })

        it('handles link.concat() after resolved', () => {

            const a = Engine.object({
                x: Engine.link('..')
            })

            const b = Engine.object({
                x: Engine.forbidden()
            })

            a.validate({ x: {} }, { debug: true })

            const schema = a.concat(b)
            const debug = schema.validate({ x: {} }, { debug: true }).debug
            expect(debug).to.equal([
                { type: 'entry', path: [] },
                { type: 'rule', name: 'when', result: '0.concat', path: ['x'] },
                { type: 'entry', path: ['x'] },
                { type: 'resolve', ref: 'ref:local:label', to: 'x', path: ['x'] }
            ])
        })
    })
})
