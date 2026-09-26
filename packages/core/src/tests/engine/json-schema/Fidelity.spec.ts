/**
 * Not from upstream: the conversion into JSON Schema is verified against the engine with ajv, on random schemas and
 * values of every version: a value the engine accepts (without conversion) is accepted by the JSON Schema (sound), and
 * when the conversion reports the JSON Schema as exact, a value the engine rejects is rejected (exact). Not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {createRequire} from 'node:module'
import E from '../../../lib/validation/engine/schema/index.js'
import {
    JsonDraft04SchemaParser,
    JsonDraft201909SchemaParser,
    JsonDraft202012SchemaParser,
    JsonSchemaParser,
    OpenApi31SchemaParser,
    OpenApiSchemaParser
} from '../../../lib/validation/engine/json-schema/index.js'

const require = createRequire(import.meta.url)
const Ajv = require('ajv').default
const Ajv2019 = require('ajv/dist/2019').default
const Ajv2020 = require('ajv/dist/2020').default
const Draft4 = require('ajv-draft-04')
const addFormats = require('ajv-formats')

//Deterministic pseudo random numbers (mulberry32)
function random(seed) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

let rnd = random(1)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const chance = (p) => rnd() < p

function schema(d) {
    const kind = pick(d > 2 ? ['string', 'number', 'boolean', 'any'] : ['string', 'number', 'boolean', 'any', 'object', 'object', 'array', 'alternatives', 'null', 'misc', 'when'])
    let s
    switch (kind) {
        case 'string':
            s = E.string()
            if (chance(0.3)) s = s.min(pick([0, 1, 2]))
            if (chance(0.3)) s = s.max(pick([1, 3]))
            if (chance(0.1)) s = s.length(2)
            if (chance(0.2)) s = s.pattern(pick([/^[a-z]*$/, /b/, /^x/i]), chance(0.2) ? {invert: true} : undefined)
            if (chance(0.15)) s = s.valid('a', 'bb', 'c')
            if (chance(0.1)) s = s.valid('a').insensitive()
            if (chance(0.15)) s = s.allow('', null)
            if (chance(0.1)) s = s.allow(1)
            if (chance(0.05)) s = s.alphanum()
            if (chance(0.05)) s = s.token()
            if (chance(0.05)) s = s.hex()
            break
        case 'number':
            s = E.number()
            if (chance(0.2)) s = s.integer()
            if (chance(0.2)) s = s[pick(['int8', 'uint8', 'int16', 'uint32', 'float', 'double', 'port'])]()
            if (chance(0.3)) s = s.min(pick([-1, 0, 2]))
            if (chance(0.3)) s = s.max(pick([3, 10, 300]))
            if (chance(0.15)) s = s.greater(pick([0, 1]))
            if (chance(0.15)) s = s.less(pick([5, 200]))
            if (chance(0.1)) s = s.multiple(pick([2, 3]))
            if (chance(0.1)) s = s.sign(pick(['positive', 'negative']))
            if (chance(0.15)) s = s.allow(null)
            if (chance(0.1)) s = s.invalid(3)
            if (chance(0.1)) s = s.valid(1, 2, 'x')
            break
        case 'boolean':
            s = E.boolean()
            if (chance(0.2)) s = s.valid(true)
            break
        case 'null':
            s = E.valid(null)
            break
        case 'any':
            s = E.any()
            if (chance(0.2)) s = s.valid({a: 1}, 'x', 2)
            if (chance(0.1)) s = s.invalid('x')
            break
        case 'object': {
            const keys = {}
            for (const k of ['a', 'b', 'xa'].filter(() => chance(0.5))) {
                let c = schema(d + 1)
                if (chance(0.3)) c = c.required()
                else if (chance(0.05)) c = c.forbidden()
                keys[k] = c
            }
            s = chance(0.2) ? E.object() : E.object(keys)
            if (chance(0.3)) s = s.unknown(chance(0.5))
            if (chance(0.2)) s = s.pattern(pick([/^x/, /a/]), schema(d + 1), chance(0.3) ? {fallthrough: true} : undefined)
            if (chance(0.1)) s = s.pattern(/^b/, schema(d + 1))
            if (chance(0.1)) s = s.unknown(schema(d + 1))
            if (chance(0.1)) s = s.min(1)
            if (chance(0.1)) s = s.max(2)
            if (chance(0.05)) s = s.length(1)
            if (chance(0.1)) s = s.keyNames(E.string().max(1))
            if (chance(0.1)) s = s[pick(['and', 'or', 'nand', 'xor', 'oxor'])]('a', 'b')
            if (chance(0.1)) s = s.with('a', 'b')
            if (chance(0.1)) s = s.without('a', 'b')
            break
        }
        case 'array':
            s = E.array()
            if (chance(0.5)) s = s.items(schema(d + 1))
            if (chance(0.1)) s = s.items(schema(d + 1), schema(d + 1))
            if (chance(0.25)) s = s.ordered(schema(d + 1), schema(d + 1))
            if (chance(0.2)) s = s.min(1)
            if (chance(0.2)) s = s.max(2)
            if (chance(0.05)) s = s.length(2)
            if (chance(0.15)) s = s.unique()
            if (chance(0.15)) s = s.has(schema(d + 1), chance(0.5) ? pick([{min: 0}, {min: 2}, {max: 1}, {min: 0, max: 1}, {min: 2, max: 3}]) : undefined)
            break
        case 'misc':
            s = pick([
                () => E.date(), () => E.date().iso(), () => E.binary(), () => E.func(), () => E.symbol(),
                () => E.any().custom((v) => v), () => E.string().empty(''), () => E.string().lowercase(), () => E.string().trim(),
                () => E.string().email(), () => E.string().guid(), () => E.string().isoDate(), () => E.string().uri(),
                () => E.string().ip({cidr: 'forbidden'}), () => E.string().ip(), () => E.string().max(1, 'utf8'), () => E.string().pattern(/a/i),
                () => E.object({a: E.number()}).rename('b', 'a'), () => E.object({a: E.number(), b: E.number().min(E.ref('a'))}),
                () => E.object({a: E.string(), b: E.valid(E.ref('a'))}), () => E.array().items(E.number().required()),
                () => E.number().precision(1), () => E.string().creditCard(), () => E.array().single().items(E.number()),
                () => E.object({a: E.number(), b: E.link('#x')}).id('x'), () => E.object({a: E.link('#n')}).shared(E.number().id('n'))
            ])()
            break
        case 'when': {
            const condition = pick([E.number(), E.string().min(2), E.object({a: E.number().required()})])
            const then = schema(d + 1), otherwise = schema(d + 1)
            s = pick([
                () => E.any().when(condition, {then, otherwise}),
                () => E.any().when(condition, {then}),
                () => E.alternatives().conditional(condition, {then, otherwise}),
                () => E.object({a: E.any(), b: E.any().when('a', {is: E.number(), then, otherwise})}),
                () => E.object({a: E.any(), b: E.alternatives().conditional('a', {is: E.number(), then, otherwise})})
            ])()
            break
        }
        case 'alternatives':
            s = E.alternatives().try(schema(d + 1), schema(d + 1))
            if (chance(0.5)) s = s.match(pick(['one', 'all', 'none']))
            break
    }
    return s
}

function value(d) {
    switch (pick(['string', 'number', 'number', 'boolean', 'null', 'object', 'object', 'array'])) {
        case 'string': return pick(['', 'a', 'A', 'bb', 'b', 'abc', 'x', 'xyz', '12', 'ab1', 'ff', '😀', 'a b', ' a', 'a@b.io', 'http://x.io/a', '2020-01-01T00:00:00Z', '4bf8e8a4-7a67-4c1e-b1c1-6f2f4b7c3d2e', '1.2.3.4', '1.2.3.4/24'])
        case 'number': return pick([0, 1, 2, 3, -1, 1.5, 4, 5, 6, 10, 200, 255, 256, -129, 300, 65536, 4294967296, 1e39, 2 ** 60])
        case 'boolean': return chance(0.5)
        case 'null': return null
        case 'object': {
            if (d > 2) return {}
            const o = {}
            for (const k of ['a', 'b', 'xa', 'bc', 'z'].filter(() => chance(0.4))) o[k] = value(d + 1)
            return o
        }
        default: {
            if (d > 2) return []
            const a = []
            const n = Math.floor(rnd() * 4)
            for (let i = 0; i < n; ++i) a.push(value(d + 1))
            return a
        }
    }
}

const modes = {
    'json-2020-12': [JsonDraft202012SchemaParser, () => new Ajv2020({strict: false})],
    'json-draft-2019-09': [JsonDraft201909SchemaParser, () => new Ajv2019({strict: false})],
    'json': [JsonSchemaParser, () => new Ajv({strict: false})],
    'json-draft-04': [JsonDraft04SchemaParser, () => new Draft4({strict: false})],
    'open-api': [OpenApiSchemaParser, () => new Draft4({strict: false})],
    'open-api-3.1': [OpenApi31SchemaParser, () => new Ajv2020({strict: false})]
}

const prefsSets = [
    {convert: false, allowUnknown: true, stripUnknown: true},
    {convert: false}
]

/**
 * Whether a value holds an empty array (ajv skips contains for an empty array with ordered items)
 * @param value
 */
function hasEmptyArray(value) {
    if (Array.isArray(value)) return !value.length || value.some(hasEmptyArray)
    return !!value && typeof value === 'object' && Object.values(value).some(hasEmptyArray)
}

function check(seed, count) {
    rnd = random(seed)
    const failures = []
    let checked = 0
    let exact = 0
    for (let i = 0; i < count; ++i) {
        let s
        try {
            s = schema(0)
        } catch {
            continue
        }
        const prefs = pick(prefsSets)
        for (const [mode, [Parser, createAjv]] of Object.entries(modes)) {
            const parser = new Parser({preferences: prefs})
            const json = parser.parse(s.describe())
            const isExact = parser.isExact(json)
            const ajv = createAjv()
            addFormats(ajv)
            let validate
            try {
                //OpenAPI schemas refer to the components of their document
                validate = ajv.compile(mode.startsWith('open-api') && json.schemas ? {...json, components: {schemas: json.schemas}} : json)
            } catch (error) {
                failures.push({mode, reason: `compile: ${error.message}`, schema: s.describe(), json})
                continue
            }
            for (let j = 0; j < 6; ++j) {
                const v = value(0)
                //Numbers beyond the safe integers are rejected by the engine (unless unsafe), and ajv's multipleOf fails with them
                if (JSON.stringify(v).match(/e\+39|1152921504606847000/)) continue
                let engine
                try {
                    engine = !s.validate(structuredClone(v), prefs).error
                } catch {
                    //A link outside of the schema boundaries
                    continue
                }
                const accepted = validate(structuredClone(v))
                checked++
                if (isExact) exact++
                if (engine && !accepted) failures.push({mode, reason: 'unsound', schema: s.describe(), json, value: v, prefs})
                const ajvContainsBug = hasEmptyArray(v) && /"contains"/.test(JSON.stringify(json)) && /"(prefixItems|additionalItems)"/.test(JSON.stringify(json))
                if (isExact && !engine && accepted && !ajvContainsBug) failures.push({mode, reason: 'not exact', schema: s.describe(), json, value: v, prefs})
            }
        }
    }
    return {failures, checked, exact}
}

describe('JSON Schema conversion fidelity', () => {

    for (const seed of [20260927, 1, 2]) {
        it(`is sound, and exact when reported exact (seed ${seed})`, () => {
            const {failures, checked, exact} = check(seed, 100)
            if (failures.length) throw new Error(`${failures.length} failures, first: ${JSON.stringify(failures[0])}`)
            //The checks must exercise exact conversions
            if (checked < 2000 || exact / checked < 0.5) throw new Error(`Too few checks: ${checked} (${exact} exact)`)
        })
    }
})
