/**
 * Not from upstream: the conversion of JSON Schemas into schemas is verified against ajv (with ajv-formats), on random
 * JSON Schemas and values of every version: the schema accepts exactly the values ajv accepts. Not type-checked.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import {createRequire} from 'node:module'
import {fromJsonSchema} from '../../../lib/validation/engine/json-schema/import.js'

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
let DIALECT, oas30, v2020, v2019, v04, defsKey

function schema(d) {
    if (chance(0.05)) return pick([true, false])
    const s = {}
    if (chance(0.7)) s.type = chance(0.15) ? pick([['string', 'null'], ['integer', 'string'], ['number', 'integer'], ['object', 'array']]) : pick(d > 2 ? ['string', 'number', 'integer', 'boolean', 'null'] : ['string', 'number', 'integer', 'boolean', 'null', 'object', 'object', 'array', 'array'])
    const types = s.type === undefined ? ['string', 'number', 'object', 'array'].filter(() => chance(0.2)) : [].concat(s.type)
    if (types.includes('string')) {
        if (chance(0.3)) s.minLength = pick([0, 1, 2])
        if (chance(0.3)) s.maxLength = pick([1, 3])
        if (chance(0.2)) s.pattern = pick(['^[a-z]*$', 'b', '^x', '\\d'])
        if (chance(0.2)) s.format = pick(['date', 'date-time', 'email', 'uuid', 'ipv4', 'uri', 'hostname', 'unknown-format'])
    }
    if (types.includes('number') || types.includes('integer')) {
        if (chance(0.3)) s.minimum = pick([-1, 0, 2, -128])
        if (chance(0.3)) s.maximum = pick([3, 10, 127, 255])
        if (chance(0.15)) { if (v04) { s.exclusiveMinimum = true; s.minimum = s.minimum ?? 0 } else s.exclusiveMinimum = pick([0, 1]) }
        if (chance(0.15)) { if (v04) { s.exclusiveMaximum = true; s.maximum = s.maximum ?? 5 } else s.exclusiveMaximum = pick([5, 200]) }
        if (chance(0.1)) s.multipleOf = pick([2, 0.5, 3])
        if (chance(0.05)) s.format = pick(['int32', 'float'])
    }
    if (types.includes('object') && d < 3) {
        if (chance(0.7)) { s.properties = {}; for (const k of ['a', 'b', 'xa'].filter(() => chance(0.5))) s.properties[k] = schema(d + 1) }
        if (chance(0.4)) s.required = ['a', 'b', 'c'].filter(() => chance(0.4))
        if (chance(0.3)) s.additionalProperties = chance(0.5) ? chance(0.5) : schema(d + 1)
        if (chance(0.2)) s.patternProperties = {'^x': schema(d + 1), ...(chance(0.3) ? {a: schema(d + 1)} : {})}
        if (chance(0.1)) s.propertyNames = {maxLength: 2}
        if (chance(0.1)) s.minProperties = 1
        if (chance(0.1)) s.maxProperties = 2
        if (chance(0.1)) { if (v2019 || v2020) s.dependentRequired = {a: ['b']}; else s.dependencies = {a: ['b']} }
        if (chance(0.1) && !v04) { if (v2019 || v2020) s.dependentSchemas = {a: schema(d + 1)}; else s.dependencies = {...s.dependencies, b: schema(d + 1)} }
        if (chance(0.1) && (v2019 || v2020)) s.unevaluatedProperties = chance(0.5) ? false : schema(d + 1)
    }
    if (types.includes('array') && d < 3) {
        if (chance(0.3)) {
            const prefix = [schema(d + 1), schema(d + 1)]
            const rest = pick([undefined, false, schema(d + 1)])
            if (v2020) { s.prefixItems = prefix; if (rest !== undefined) s.items = rest } else { s.items = prefix; if (rest !== undefined) s.additionalItems = rest }
        } else if (chance(0.6)) s.items = schema(d + 1)
        if (chance(0.2)) s.minItems = 1
        if (chance(0.2)) s.maxItems = 2
        if (chance(0.15)) s.uniqueItems = true
        if (chance(0.15) && !v04) { s.contains = schema(d + 1); if ((v2019 || v2020) && chance(0.5)) { s.minContains = pick([0, 2]); if (chance(0.5)) s.maxContains = pick([1, 3]) } }
        if (chance(0.1) && (v2019 || v2020)) s.unevaluatedItems = chance(0.5) ? false : schema(d + 1)
    }
    if (chance(0.1)) s.enum = pick([['a', 'bb', 1, null], [1, 2, 3], [{a: 1}, [1], 'x'], ['']])
    if (chance(0.05) && !v04) s.const = pick(['a', 1, null, {a: 1}])
    if (d < 2) {
        if (chance(0.08)) s.allOf = [schema(d + 1), schema(d + 1)]
        if (chance(0.08)) s.anyOf = [schema(d + 1), schema(d + 1)]
        if (chance(0.08)) s.oneOf = [schema(d + 1), schema(d + 1)]
        if (chance(0.06)) s.not = schema(d + 1)
        if (chance(0.06) && !v04) { s.if = schema(d + 1); if (chance(0.7)) s.then = schema(d + 1); if (chance(0.7)) s.else = schema(d + 1) }
    }
    if (d > 0 && chance(0.1)) {
        //References: to the definitions (the recursive node refers to itself) or the root
        const ref = pick([`#/${defsKey}/node`, `#/${defsKey}/str`, '#'])
        if (v2019 || v2020 || chance(0.5)) return {$ref: ref}
        s.$ref = ref
    }
    if (oas30 && chance(0.2)) s.nullable = true
    if (chance(0.05)) s.description = 'd'
    if (chance(0.05)) s.title = 't'
    return s
}

function value(d) {
    switch (pick(['string', 'number', 'number', 'boolean', 'null', 'object', 'object', 'array', 'array'])) {
        case 'string': return pick(['', 'a', 'A', 'bb', 'b', 'abc', 'x', 'xyz', '12', 'ab1', '😀', 'a@b.io', '2020-01-01', '2020-01-01T00:00:00Z', '1.2.3.4', 'http://x.io', 'localhost', '4bf8e8a4-7a67-4c1e-b1c1-6f2f4b7c3d2e'])
        case 'number': return pick([0, 1, 2, 3, -1, 1.5, 0.5, 4, 5, 6, 10, 127, 128, 200, 255, 256, -128, -129, 2.5])
        case 'boolean': return chance(0.5)
        case 'null': return null
        case 'object': {
            if (d > 2) return {}
            if (chance(0.1)) return {a: 1}
            if (chance(0.1)) return {v: 1, next: pick([{v: 2}, {v: 'x'}, {v: 2, next: {v: 3}}, {}])}
            const o = {}
            for (const k of ['a', 'b', 'c', 'xa', 'xb', 'zz'].filter(() => chance(0.4))) o[k] = value(d + 1)
            return o
        }
        default: {
            if (d > 2) return []
            if (chance(0.1)) return [{a: 1}, {a: 1}]
            const a = []
            const n = Math.floor(rnd() * 4)
            for (let i = 0; i < n; ++i) a.push(value(d + 1))
            return a
        }
    }
}

const ajvs = {
    'draft-2020-12': () => new Ajv2020({strict: false, logger: false}),
    'draft-2019-09': () => new Ajv2019({strict: false, logger: false}),
    'draft-07': () => new Ajv({strict: false, logger: false}),
    'draft-04': () => new Draft4({strict: false, logger: false}),
    'openapi-3.0': () => new Draft4({strict: false, logger: false})
}

function check(dialect, seed, count) {
    DIALECT = dialect
    oas30 = dialect === 'openapi-3.0'
    v2020 = dialect === 'draft-2020-12'
    v2019 = dialect === 'draft-2019-09'
    v04 = dialect === 'draft-04' || oas30
    defsKey = v04 ? 'definitions' : '$defs'
    rnd = random(seed)
    const failures = []
    let checked = 0
    for (let i = 0; i < count; ++i) {
        const s = schema(0)
        if (typeof s === 'object') s[defsKey] = {node: {type: 'object', properties: {v: {type: 'number'}, next: {$ref: `#/${defsKey}/node`}}, required: ['v']}, str: {type: 'string', maxLength: 2}}
        //ajv ignores contains with ordered items, and counts every item as evaluated by contains
        const ajvContainsBug = /"contains"/.test(JSON.stringify(s)) && /"(prefixItems|unevaluatedItems|items":\[)/.test(JSON.stringify(s))
        const ajv = ajvs[dialect]()
        addFormats(ajv)
        let validate
        try {
            validate = ajv.compile(s)
        } catch {
            continue
        }
        const imported = fromJsonSchema(s, {dialect})
        for (let j = 0; j < 8; ++j) {
            const v = value(0)
            let expected
            try {
                expected = validate(structuredClone(v))
            } catch {
                //ajv's generated code throws on some schemas
                continue
            }
            const actual = !imported.validate(structuredClone(v)).error
            checked++
            if (expected !== actual && !ajvContainsBug) failures.push({schema: s, value: v, expected, actual})
        }
    }
    return {failures, checked}
}

describe('JSON Schema import fidelity', () => {

    for (const dialect of Object.keys(ajvs)) {
        it(`validates like ajv (${dialect})`, () => {
            const {failures, checked} = check(dialect, 20260927, 150)
            if (failures.length) throw new Error(`${failures.length} failures, first: ${JSON.stringify(failures[0])}`)
            if (checked < 800) throw new Error(`Too few checks: ${checked}`)
        })
    }
})
