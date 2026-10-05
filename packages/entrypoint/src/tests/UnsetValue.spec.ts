import {describe, it} from 'node:test'
import assert from 'node:assert'
import {inspect} from 'node:util'
import upstreamUnset from 'unset-value'
import {unsetValue} from '../lib/UnsetValue.js'

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function seededRandom(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = seededRandom(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

const KEYS: string[] = ['a', 'b', 'c', 'a.b', 'b.c', 'a\\.b', '0', '']

/**
 * A random value: nested objects, the keys with dots, the values with and without values (has-values)
 * @param depth
 */
function randomValue(depth: number = 0): unknown {
    switch (Math.floor(random() * (depth > 2 ? 6 : 9))) {
        case 0:
            return pick([null, 0, 1, false, true, 'x', ''])
        case 1:
            return pick([[], [1], [''], {}, {k: undefined}, {k: ''}])
        case 2:
            return pick([new Date(0), /re/, new RegExp(''), new Error(''), new Error('e'), Buffer.from(''), Buffer.from('a')])
        case 3:
            return pick([new Map(), new Map([[1, 1]]), new Set(), new Set([1]), (): number => 1, undefined])
        case 4:
            return pick([NaN, Symbol.for('s'), 5n])
        case 5:
            return pick([[{a: 1}], [[]]])
        default: {
            const object: Record<string, unknown> = {}
            for (let index: number = 0; index < Math.floor(random() * 4); index++) object[pick(KEYS)] = randomValue(depth + 1)
            return object
        }
    }
}

function randomPath(): string | string[] {
    if (random() < 0.15) return pick([['a', 'b'], ['a.b'], ['a', 'b', 'c'], []])
    return Array.from({length: 1 + Math.floor(random() * 3)}, (): string => pick([...KEYS, 'missing', 'constructor', '__proto__', 'prototype'])).join('.')
}

/**
 * A copy of the plain objects and the arrays of a value (the other values as they are)
 * @param value
 */
function copyPackages(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(copyPackages)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]): [string, unknown] => [key, copyPackages(item)]))
    return value
}

/**
 * The result of a removal, the object after it (or the error)
 * @param unset
 * @param input
 * @param path
 */
function outcomeOf(unset: (obj: any, path: any) => unknown, input: unknown, path: string | string[]): string {
    const object: unknown = copyPackages(input)
    try {
        const result: unknown = unset(object, path)
        return inspect({result: result, object: object}, {depth: 8, sorted: true})
    } catch (error) {
        return inspect({error: (error as Error).message, object: object}, {depth: 8, sorted: true})
    }
}

describe('UnsetValue', (): void => {

    it('removes the properties as unset-value', (): void => {
        let removed: number = 0
        for (let run: number = 0; run < 20000; run++) {
            const input: unknown = random() < 0.95 ? randomValue(2 + Math.floor(random() * 2) - 2) : pick([[], 'text', null, 5])
            const object: unknown = typeof input === 'object' && input !== null && !Array.isArray(input) && !(input instanceof Map) ? input : {a: {b: input}, 'a.b': input}
            const subject: unknown = random() < 0.05 ? input : object
            const path: string | string[] = randomPath()
            const expected: string = outcomeOf(upstreamUnset, subject, path)
            assert.strictEqual(outcomeOf(unsetValue, subject, path), expected, `${inspect(subject, {depth: 6})} ${inspect(path)}`)
            if (expected !== inspect({result: true, object: copyPackages(subject)}, {depth: 8, sorted: true})) removed++
        }
        assert.ok(removed > 2000, `removed ${removed}`)
    })

    it('removes a key containing a dot, as 2.x', (): void => {
        const data: Record<string, unknown> = {'a.b': 'x', a: {b: 'y'}, id: 1}
        unsetValue(data, 'a.b')
        assert.deepStrictEqual(data, {a: {b: 'y'}, id: 1})
    })
})
