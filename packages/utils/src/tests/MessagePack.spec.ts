import {describe, it} from 'node:test'
import assert from 'node:assert'
import {decode as UpstreamDecode, encode as UpstreamEncode, ExtData as UpstreamExtData} from '@msgpack/msgpack'
import {MessagePack} from '../exports/Utils.js'

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function Random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = Random(20261001)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

/**
 * The integers at the limits of the formats
 */
const INTEGERS: number[] = [0, 1, 0x7f, 0x80, 0xff, 0x100, 0xffff, 0x10000, 0xffffffff, 0x100000000, Number.MAX_SAFE_INTEGER,
    -1, -0x20, -0x21, -0x80, -0x81, -0x8000, -0x8001, -0x80000000, -0x80000001, Number.MIN_SAFE_INTEGER]

/**
 * A random string: ASCII, other characters, surrogate pairs, of any length (the encodings change at 32, 50, 200 and
 * 256 bytes)
 */
function RandomString(): string {
    const length: number = pick([0, 1, 5, 31, 32, 49, 51, 199, 201, 255, 300, 70000])
    const alphabet: string[] = pick([['a', 'b', 'z', '0', ' '], ['é', 'ü', 'ß'], ['中', '文', '字'], ['😀', '🚀', 'a', '中']])
    let value: string = ''
    while (value.length < length) value += pick(alphabet)
    return value
}

/**
 * A random value
 * @param depth
 */
function RandomValue(depth: number = 0): unknown {
    const kind: number = Math.floor(random() * (depth > 3 ? 9 : 13))
    switch (kind) {
        case 0:
            return pick([null, undefined, true, false])
        case 1:
            return pick(INTEGERS)
        case 2:
            return Math.floor((random() - 0.5) * 2 ** (1 + Math.floor(random() * 52)))
        case 3:
            return pick([0.5, -1.25, Math.PI, 1e300, -1e-300, NaN, Infinity, -Infinity, -0, random()])
        case 4:
            return RandomString()
        case 5:
            return pick([0n, 1n, -1n, 2n ** 63n - 1n, -(2n ** 63n), 2n ** 64n - 1n, BigInt(Math.floor(random() * 1e15)) * -7n])
        case 6:
            return new Date(pick([0, 1, -1, 1700000000123, -62135596800000, 253402300799999, 17179869184000, Math.floor(random() * 4e12)]))
        case 7:
            return pick([new Uint8Array([1, 2, 3]), Buffer.from('buffer'), new Uint8Array(300), new Int16Array([1, -1]), new Uint8Array(70000)])
        case 8:
            return pick(['key', '', 'a'.repeat(16), 'a'.repeat(17)])
        case 9:
        case 10: {
            const length: number = pick([0, 1, 3, 15, 16, 17])
            return Array.from({length: length}, (): unknown => RandomValue(depth + 1))
        }
        default: {
            const object: Record<string, unknown> = {}
            const size: number = pick([0, 1, 4, 15, 16, 20])
            for (let index: number = 0; index < size; index++) object[pick(['id', 'name', 'value', 'é', 'a'.repeat(17), `k${index}`, RandomString().slice(0, 20)])] = RandomValue(depth + 1)
            return pick([object, object, object, new Map([['a', 1]]), new Set([1])])
        }
    }
}

/**
 * The result or the error of a function
 * @param fn
 */
function Outcome(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        return {value: fn()}
    } catch (error) {
        return {error: `${(error as Error).name}: ${(error as Error).message}`}
    }
}

const UPSTREAM_ENCODE_OPTIONS = {useBigInt64: true, ignoreUndefined: true} as const

describe('MessagePack', (): void => {

    it('encodes and decodes as @msgpack/msgpack', (): void => {
        for (let run: number = 0; run < 1000; run++) {
            const value: unknown = RandomValue()
            const expected: Uint8Array = UpstreamEncode(value, UPSTREAM_ENCODE_OPTIONS)
            const encoded: Uint8Array = MessagePack.encode(value)
            assert.ok(Buffer.from(encoded).equals(Buffer.from(expected)), `encoding of run ${run}`)
            assert.deepStrictEqual(MessagePack.decode(expected), UpstreamDecode(expected, {useBigInt64: true}), `decoding of run ${run}`)
        }
    })

    it('fails as @msgpack/msgpack on the invalid inputs', (): void => {
        for (let run: number = 0; run < 1000; run++) {
            let bytes: Uint8Array
            if (run % 2) {
                //A truncated or extended encoding
                const valid: Uint8Array = UpstreamEncode(RandomValue(), UPSTREAM_ENCODE_OPTIONS)
                bytes = run % 4 === 1 ? valid.subarray(0, Math.floor(random() * valid.length)) : new Uint8Array([...valid, 0xc0])
            } else {
                bytes = Uint8Array.from({length: Math.floor(random() * 12)}, (): number => Math.floor(random() * 256))
            }
            const outcome: { value?: unknown, error?: string } = Outcome((): unknown => MessagePack.decode(bytes))
            const expected: { value?: unknown, error?: string } = Outcome((): unknown => UpstreamDecode(bytes, {useBigInt64: true}))
            if (outcome.value instanceof Object && expected.value instanceof UpstreamExtData) {
                assert.deepStrictEqual({...outcome.value}, {...expected.value})
            } else {
                assert.deepStrictEqual(outcome, expected, `run ${run}: ${Buffer.from(bytes).toString('hex')}`)
            }
        }
    })

    it('keeps the extension types it does not decode, and encodes them again', (): void => {
        const bytes: Uint8Array = new Uint8Array([0xd5, 0x07, 0x01, 0x02])
        const decoded: { type: number, data: Uint8Array } = MessagePack.decode(bytes)
        assert.strictEqual(decoded.type, 7)
        assert.deepStrictEqual([...decoded.data], [1, 2])
        assert.deepStrictEqual([...MessagePack.encode(decoded)], [...bytes])
    })

    it('encodes again while encoding, decodes again while decoding', (): void => {
        const value: Record<string, unknown> = {
            get nested(): Uint8Array {
                return MessagePack.encode({inner: [1, 2, 3]})
            }
        }
        const decoded: { nested: Uint8Array } = MessagePack.decode(MessagePack.encode(value))
        assert.deepStrictEqual(MessagePack.decode(decoded.nested), {inner: [1, 2, 3]})
        assert.deepStrictEqual(MessagePack.parse(MessagePack.stringify({a: 1n, b: new Date(5)})), {a: 1n, b: new Date(5)})
    })
})
