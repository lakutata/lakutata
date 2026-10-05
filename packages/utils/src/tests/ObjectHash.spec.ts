import {describe, it} from 'node:test'
import assert from 'node:assert'
import UpstreamObjectHash from 'object-hash'
import {objectHash, type ObjectHashOptions} from '../exports/Utils.js'

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

class Klass {
    public x: number = 1
}

class Other {
    public x: number = 1
}

function named(): number {
    return 1
}

/**
 * A random value: the primitives, the objects of the types the upstream knows and does not know, nested
 * @param depth
 */
function randomValue(depth: number = 0): unknown {
    switch (Math.floor(random() * (depth > 2 ? 10 : 15))) {
        case 0:
            return pick([null, undefined, true, false, 0, -0, NaN, Infinity, -1.5, 7, 2n, -3n])
        case 1:
            return pick(['', 'a', 'héllo', '中文', '😀', 'x'.repeat(100), 'string:1:a'])
        case 2:
            return pick([new Date(0), new Date(1700000000000), new Error('e'), new TypeError('t'), /re/g, new URL('https://a.b/c')])
        case 3:
            return pick([Buffer.from('ab'), Buffer.from([0xff, 0x00]), new Uint8Array([1, 2]), new Float64Array([1.5]), new Int16Array([-1]), new Uint8Array([1]).buffer])
        case 4:
            return pick([Symbol.for('s'), Symbol('local'), (): number => 1, named, async (): Promise<void> => undefined, function* generator(): Generator<number> {
                yield 1
            }, Math.max, String])
        case 5:
            return pick([new String('s'), new Number(1), new Boolean(false), Object(Symbol.for('boxed'))])
        case 6:
            return pick([new Klass(), new Other(), Object.create(null), new Map(), new Set(), new WeakMap(), Promise.resolve(1), new DataView(new ArrayBuffer(1))])
        case 7:
            return pick([new Blob(['b']), new File(['f'], 'name.txt', {type: 'text/plain', lastModified: 5}), new Klass()])
        case 8:
            return pick([[], [1], [3, 1, 2]])
        case 9:
            return pick([{}, {b: 1, a: 2}, {a: 2, b: 1}])
        case 10:
        case 11:
            return Array.from({length: Math.floor(random() * 4)}, (): unknown => randomValue(depth + 1))
        case 12:
            return new Set(Array.from({length: Math.floor(random() * 4)}, (): unknown => randomValue(depth + 1)))
        case 13:
            return new Map(Array.from({length: Math.floor(random() * 3)}, (): [unknown, unknown] => [randomValue(depth + 1), randomValue(depth + 1)]))
        default: {
            const object: Record<string, unknown> = {}
            for (let index: number = 0; index < Math.floor(random() * 5); index++) object[pick(['a', 'b', 'c', 'Z', '0', 'prototype', 'constructor', 'key'])] = randomValue(depth + 1)
            //A circular object
            if (random() < 0.1) object.self = object
            return object
        }
    }
}

/**
 * Random options
 */
function randomOptions(): ObjectHashOptions | undefined {
    if (random() < 0.2) return undefined
    const options: Record<string, unknown> = {}
    const choices: Record<string, unknown[]> = {
        algorithm: ['sha1', 'md5', 'sha256', 'SHA256', 'passthrough', 'Passthrough', 'unknown-hash', ''],
        encoding: ['hex', 'base64', 'binary', 'buffer', 'BASE64', 'utf8', ''],
        excludeValues: [true, false, 1, 0],
        ignoreUnknown: [true, false, 'yes'],
        respectType: [true, false, 0],
        respectFunctionNames: [true, false],
        respectFunctionProperties: [true, false],
        unorderedArrays: [true, false, 1],
        unorderedObjects: [true, false],
        unorderedSets: [true, false, null],
        replacer: [(value: unknown): unknown => typeof value === 'number' ? value * 2 : value, (value: unknown): unknown => value instanceof Map ? [...value] : value],
        excludeKeys: [(key: string): boolean => key === 'a', (key: string): boolean => key.startsWith('p')]
    }
    for (const [key, values] of Object.entries(choices)) if (random() < 0.3) options[key] = pick(values)
    return options as ObjectHashOptions
}

/**
 * The hash or the error of a function (the buffers as their hex)
 * @param fn
 */
function outcomeOf(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        const value: unknown = fn()
        return {value: Buffer.isBuffer(value) ? `buffer:${value.toString('hex')}` : value}
    } catch (error) {
        return {error: (error as Error).message}
    }
}

describe('objectHash', (): void => {

    it('hashes as object-hash', (): void => {
        const counts: Record<string, number> = {value: 0, error: 0}
        for (let run: number = 0; run < 4000; run++) {
            const value: unknown = randomValue()
            const options: ObjectHashOptions | undefined = randomOptions()
            const expected: { value?: unknown, error?: string } = outcomeOf((): unknown => UpstreamObjectHash(value as any, options as any))
            assert.deepStrictEqual(outcomeOf((): unknown => objectHash(value, options)), expected, `run ${run}`)
            counts[expected.error === undefined ? 'value' : 'error']++
        }
        assert.ok(counts.value > 2000 && counts.error > 100, JSON.stringify(counts))
    })

    it('hashes the values of 2.x as 2.x', (): void => {
        assert.strictEqual(objectHash({b: 1, a: [1, 'x', null]}), UpstreamObjectHash({b: 1, a: [1, 'x', null]}))
        assert.strictEqual(objectHash('text', {algorithm: 'md5', encoding: 'base64'}), UpstreamObjectHash('text', {algorithm: 'md5', encoding: 'base64'}))
        assert.strictEqual(objectHash({a: {b: 1}}, {algorithm: 'passthrough'}), UpstreamObjectHash({a: {b: 1}}, {algorithm: 'passthrough'}))
        assert.throws((): unknown => objectHash(undefined), /Object argument required/)
    })
})
