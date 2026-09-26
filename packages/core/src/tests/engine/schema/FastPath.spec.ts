/**
 * Not from upstream: the validation fast path (fastpath.ts) must validate like the interpreter. The tests run in the
 * verify mode of the fast path (both validate, a different result throws), with a seeded differential fuzz of random
 * schemas and values, and targeted cases.
 */
// @ts-nocheck
import {after, before, describe, it} from 'node:test'
import {expect} from '../support/Expect.js'
import Engine from '../../../lib/validation/engine/schema/index.js'
import * as Common from '../../../lib/validation/engine/schema/common.js'
import {compiledFor, FALLBACK, INVALID, pure} from '../../../lib/validation/engine/schema/fastpath.js'
import {setFastPathMode} from '../../../lib/validation/engine/schema/validator.js'

//Deterministic pseudo random numbers (mulberry32)
function random(seed) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const isPositive = pure((value, helpers) => typeof value === 'number' && value > 0 ? value : helpers.error('any.invalid'))

function generator(rnd) {
    const pick = (items) => items[Math.floor(rnd() * items.length)]
    const chance = (p) => rnd() < p
    const presence = (schema) => chance(0.2) ? schema.required() : chance(0.05) ? schema.forbidden() : schema
    const keysOf = () => ['a', 'b', 'c', 'd'].filter(() => chance(0.5))

    function schema(depth) {
        const kinds = depth > 2 ? ['string', 'number', 'boolean', 'any', 'date'] : ['string', 'number', 'boolean', 'any', 'date', 'object', 'object', 'array', 'alternatives', 'unsupported']
        const kind = pick(kinds)
        let s
        switch (kind) {
            case 'string':
                s = Engine.string()
                if (chance(0.3)) s = s.min(pick([0, 1, 3]))
                if (chance(0.3)) s = s.max(pick([2, 5]))
                if (chance(0.2)) s = s.pattern(/^[a-z]*$/)
                if (chance(0.15)) s = s.trim()
                if (chance(0.1)) s = s.lowercase()
                if (chance(0.15)) s = s.valid('a', 'B', 'c')
                if (chance(0.1)) s = s.insensitive()
                if (chance(0.15)) s = s.allow('', null)
                if (chance(0.15)) s = s.default('dflt')
                if (chance(0.05)) s = s.custom(isPositive)
                break
            case 'number':
                s = Engine.number()
                if (chance(0.3)) s = s.integer()
                if (chance(0.3)) s = s.min(pick([-1, 0, 2]))
                if (chance(0.2)) s = s.max(pick([3, 10]))
                if (chance(0.15)) s = s.greater(0)
                if (chance(0.1)) s = s.multiple(2)
                if (chance(0.1)) s = s.precision(1)
                if (chance(0.15)) s = s.allow(null)
                if (chance(0.1)) s = s.invalid(3)
                if (chance(0.15)) s = s.default(7)
                if (chance(0.1)) s = s.failover(1)
                break
            case 'boolean':
                s = Engine.boolean()
                if (chance(0.3)) s = s.truthy('yes').falsy('no')
                if (chance(0.2)) s = s.default(false)
                break
            case 'date':
                s = Engine.date()
                if (chance(0.3)) s = s.min('2000-01-01')
                if (chance(0.2)) s = s.iso()
                break
            case 'any':
                s = Engine.any()
                if (chance(0.2)) s = s.default({x: [1]})
                if (chance(0.1)) s = s.default(() => 'computed')
                if (chance(0.2)) s = s.custom(isPositive)
                break
            case 'object': {
                const keys = {}
                for (const key of keysOf()) keys[key] = schema(depth + 1)
                s = chance(0.15) ? Engine.object() : Engine.object(keys)
                if (chance(0.2)) s = s.unknown(chance(0.5))
                if (chance(0.2)) s = s.pattern(chance(0.5) ? /^x/ : Engine.string().min(2), schema(depth + 1))
                if (chance(0.1)) s = s.min(1)
                if (chance(0.1)) s = s.default({a: 'x'})
                break
            }
            case 'array':
                s = Engine.array()
                if (chance(0.6)) s = s.items(schema(depth + 1))
                else if (chance(0.5)) s = s.ordered(schema(depth + 1), schema(depth + 1))
                if (chance(0.2)) s = s.min(1)
                if (chance(0.2)) s = s.max(3)
                if (chance(0.1)) s = s.sparse()
                break
            case 'alternatives':
                s = Engine.alternatives().try(schema(depth + 1), schema(depth + 1), schema(depth + 1))
                break
            default:
                //Constructs the fast path does not compile
                s = pick([
                    Engine.object({a: Engine.any(), b: Engine.ref('a')}),
                    Engine.any().when('.', {is: 1, then: Engine.number()}),
                    Engine.any().custom((v) => v),
                    Engine.string().empty(''),
                    Engine.object({x: Engine.number(), y: Engine.link('x')})
                ])
        }
        return presence(s)
    }

    function value(depth) {
        const kind = pick(['string', 'number', 'number', 'boolean', 'object', 'array', 'undefined', 'null', 'date', 'special'])
        switch (kind) {
            case 'string':
                return pick(['', 'a', 'B', 'abc', ' ab ', 'xyz12', '12', '1.5', 'yes', 'no', 'true', '2001-02-03', 'x'])
            case 'number':
                return pick([0, -0, 1, 2, 3, 4, -1, 1.5, 1.25, 10, 11, NaN, Infinity, 2 ** 60])
            case 'boolean':
                return chance(0.5)
            case 'object': {
                if (depth > 2) return {}
                const obj = {}
                for (const key of ['a', 'b', 'c', 'd', 'xa', 'zz'].filter(() => chance(0.5))) obj[key] = value(depth + 1)
                return obj
            }
            case 'array': {
                if (depth > 2) return []
                const arr = []
                const length = Math.floor(rnd() * 4)
                for (let i = 0; i < length; ++i) arr.push(value(depth + 1))
                if (chance(0.1)) arr.length += 1
                return arr
            }
            case 'undefined':
                return undefined
            case 'null':
                return null
            case 'date':
                return new Date(pick([0, 946684800000, 1e12]))
            default:
                return pick([() => 1, Symbol('s'), Object.create(null), [undefined]])
        }
    }

    return {schema, value}
}

const optionSets = [
    undefined,
    {convert: false},
    {allowUnknown: true, stripUnknown: true, abortEarly: true, cache: false, convert: true},
    {stripUnknown: {arrays: true, objects: true}},
    {abortEarly: false},
    {presence: 'required'},
    {noDefaults: true},
    {skipFunctions: true, allowUnknown: false}
]

describe('validation fast path', () => {

    before(() => setFastPathMode('verify'))
    after(() => setFastPathMode('on'))

    it('validates like the interpreter (differential fuzz)', () => {
        const rnd = random(20260927)
        const {schema, value} = generator(rnd)
        const outcomes = {fast: 0, invalid: 0, fallback: 0, interpreted: 0}
        for (let i = 0; i < 1500; ++i) {
            const s = schema(0)
            for (let j = 0; j < 4; ++j) {
                const v = value(0)
                const options = optionSets[Math.floor(rnd() * optionSets.length)]
                //Verify mode: a different result than the interpreter throws
                s.validate(v, options)
                const compiled = compiledFor(s, Common.preferences(Common.defaults, options))
                if (!compiled) {
                    outcomes.interpreted++
                    continue
                }
                const result = compiled(v)
                if (result === FALLBACK) outcomes.fallback++
                else if (result === INVALID) outcomes.invalid++
                else outcomes.fast++
            }
        }
        const total = outcomes.fast + outcomes.invalid + outcomes.fallback + outcomes.interpreted
        //The fuzz must exercise the fast path, not only the interpreter
        expect(outcomes.fast / total).to.be.above(0.15)
        expect(outcomes.invalid / total).to.be.above(0.15)
        expect(outcomes.fallback).to.be.above(0)
        expect(outcomes.interpreted).to.be.above(0)
    })

    it('validates asynchronously like the interpreter', async () => {
        const rnd = random(42)
        const {schema, value} = generator(rnd)
        for (let i = 0; i < 300; ++i) {
            const s = schema(0)
            const v = value(0)
            await s.validateAsync(v, optionSets[i % optionSets.length]).catch((err) => {
                expect(err.name).to.equal('SchemaValidationException')
            })
        }
    })

    it('never changes the validated value', () => {
        setFastPathMode('on')
        const schema = Engine.object({a: Engine.number(), b: Engine.array().items(Engine.string().trim()), c: Engine.object({d: Engine.number().default(1)})})
        const settings = Object.freeze({stripUnknown: true})
        for (const input of [{a: '1', b: [' x '], c: {}, e: 1}, {a: 'x', b: [' x '], c: {}, e: 1}]) {
            const copy = JSON.parse(JSON.stringify(input))
            schema.validate(input, settings)
            expect(input).to.equal(copy)
        }
        setFastPathMode('verify')
    })

    it('computes defaults like the interpreter', () => {
        const settings = Common.preferences(Common.defaults, {})
        const schema = Engine.object({a: Engine.string().default('x'), b: Engine.any().default({c: [1]}), d: Engine.any().default(() => 1, {literal: true})})
        const value = compiledFor(schema, settings)({})
        expect(value.a).to.equal('x')
        expect(value.b).to.equal({c: [1]})
        expect(value.d()).to.equal(1)
        //A default function is computed by the interpreter
        expect(compiledFor(Engine.object({a: Engine.any().default(() => 1)}), settings)({})).to.equal(FALLBACK)
    })

    it('tries the alternatives like the interpreter', () => {
        const settings = Common.preferences(Common.defaults, {})
        const alternatives = Engine.alternatives().try(Engine.number(), Engine.string())
        expect(compiledFor(alternatives, settings)('1')).to.equal(1)
        expect(compiledFor(Engine.alternatives().try(Engine.boolean(), Engine.string()), settings)('x')).to.equal('x')
        expect(compiledFor(alternatives, settings)(true)).to.equal(INVALID)
        //An alternative which cannot be decided stops the next ones from being tried
        const undecided = Engine.alternatives().try(Engine.object({a: Engine.any().default(() => 1)}), Engine.object())
        expect(compiledFor(undecided, settings)({})).to.equal(FALLBACK)
    })

    it('compiles only the custom rules marked as pure', () => {
        const settings = Common.preferences(Common.defaults, {})
        expect(compiledFor(Engine.any().custom(isPositive), settings)).to.be.a.function()
        expect(compiledFor(Engine.any().custom((value) => value), settings)).to.equal(null)
    })

    it('is not used when off', () => {
        setFastPathMode('off')
        expect(Engine.number().validate('1').value).to.equal(1)
        setFastPathMode('verify')
    })
})
