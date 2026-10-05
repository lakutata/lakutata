import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as upstream from 'uuid'
import {UUID} from '../exports/Utils.js'

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

const bytes = (length: number): Uint8Array => Uint8Array.from({length: length}, (): number => Math.floor(random() * 256))

/**
 * The result or the error of a function (the arrays as arrays)
 * @param fn
 */
function outcomeOf(fn: () => unknown): { value?: unknown, error?: string } {
    try {
        const value: unknown = fn()
        return {value: value instanceof Uint8Array ? Array.from(value) : value}
    } catch (error) {
        return {error: `${(error as Error).name}: ${(error as Error).message}`}
    }
}

/**
 * The outcome of uuid, or the RangeError of a buffer too small: v3, v5 and v6 check it before writing (uuid writes
 * the bytes which fit)
 * @param fn
 * @param buf
 * @param offset
 */
function checked(fn: () => unknown, buf: Uint8Array | undefined, offset: number | undefined): { value?: unknown, error?: string } {
    const outcome: { value?: unknown, error?: string } = outcomeOf(fn)
    const start: number = offset ?? 0
    if (outcome.error === undefined && buf && (start < 0 || start + 16 > buf.length)) return {error: `RangeError: UUID byte range ${start}:${start + 15} is out of buffer bounds`}
    return outcome
}

/**
 * A random string: UUIDs of every version (valid or not), the nil and max UUIDs, other strings
 */
function randomCandidate(): unknown {
    const hex = (length: number): string => Array.from({length: length}, (): string => pick([...'0123456789abcdefABCDEF'])).join('')
    switch (Math.floor(random() * 6)) {
        case 0:
            return `${hex(8)}-${hex(4)}-${pick([...'0123456789abcdef'])}${hex(3)}-${pick([...'0123456789abcdef'])}${hex(3)}-${hex(12)}`
        case 1:
            return pick([UUID.NIL, UUID.MAX, UUID.NIL.toUpperCase(), UUID.MAX.toUpperCase(), upstream.v4(), upstream.v1(), upstream.v6(), upstream.v7()])
        case 2:
            return pick(['', 'not-a-uuid', `{${upstream.v4()}}`, upstream.v4().replace(/-/g, ''), ` ${upstream.v4()}`, upstream.v4().slice(0, 35)])
        case 3:
            return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(pick([11, 12, 13]))}`
        case 4:
            return pick([undefined, null, 5, {}])
        default:
            return upstream.v5(String(random()), upstream.v5.DNS)
    }
}

describe('UUID', (): void => {

    it('validates, parses and stringifies as uuid', (): void => {
        for (let run: number = 0; run < 5000; run++) {
            const candidate: any = randomCandidate()
            assert.deepStrictEqual(outcomeOf((): unknown => UUID.validate(candidate)), outcomeOf((): unknown => upstream.validate(candidate)), String(candidate))
            assert.deepStrictEqual(outcomeOf((): unknown => UUID.version(candidate)), outcomeOf((): unknown => upstream.version(candidate)), String(candidate))
            assert.deepStrictEqual(outcomeOf((): unknown => UUID.parse(candidate)), outcomeOf((): unknown => upstream.parse(candidate)), String(candidate))
            const array: Uint8Array = random() < 0.5 ? bytes(pick([16, 20])) : Uint8Array.from(upstream.parse(upstream.v4()))
            const offset: number = pick([0, 0, 2, 4])
            assert.deepStrictEqual(outcomeOf((): unknown => UUID.stringify(array, offset)), outcomeOf((): unknown => upstream.stringify(array, offset)))
        }
    })

    it('generates the UUIDs of given times, nodes and random bytes as uuid, into buffers too', (): void => {
        for (let run: number = 0; run < 3000; run++) {
            const options: Record<string, unknown> = {}
            //Always the time: without it, the time of each call (they may differ)
            options.msecs = pick([0, 1, 1700000000000, Date.UTC(2100, 0), -12219292800000, 2 ** 40])
            if (random() < 0.5) options.nsecs = pick([0, 1, 9999])
            if (random() < 0.5) options.clockseq = pick([0, 0x3fff, 1234])
            if (random() < 0.5) options.node = bytes(6)
            //Always the random bytes: the clock sequence and the node not given come from them
            options.random = bytes(pick([16, 16, 20, 8]))
            const useBuffer: boolean = random() < 0.4
            const offset: number | undefined = pick([undefined, 0, 4, 10, -1])
            for (const generate of ['v1', 'v4', 'v6'] as const) {
                const size: number = useBuffer ? 26 : 0
                const portedBuffer: Uint8Array | undefined = useBuffer ? new Uint8Array(size) : undefined
                const upstreamBuffer: Uint8Array | undefined = useBuffer ? new Uint8Array(size) : undefined
                assert.deepStrictEqual(
                    outcomeOf((): unknown => (UUID as any)[generate]({...options}, portedBuffer, offset)),
                    checked((): unknown => (upstream as any)[generate]({...options}, upstreamBuffer, offset), upstreamBuffer, offset),
                    `${generate} ${JSON.stringify(options, (_: string, value: unknown): unknown => value instanceof Uint8Array ? Array.from(value) : value)} ${offset}`
                )
            }
            const name: string | Uint8Array = random() < 0.7 ? pick(['', 'example.com', '中文', String(random())]) : bytes(pick([0, 5, 32]))
            const namespace: string | Uint8Array = pick([upstream.v5.DNS, upstream.v5.URL, upstream.v4(), Uint8Array.from(upstream.parse(upstream.v4())), bytes(15), 'invalid'])
            for (const generate of ['v3', 'v5'] as const) {
                const portedBuffer: Uint8Array | undefined = useBuffer ? new Uint8Array(20) : undefined
                const upstreamBuffer: Uint8Array | undefined = useBuffer ? new Uint8Array(20) : undefined
                const start: number | undefined = offset && offset > 0 ? offset : undefined
                assert.deepStrictEqual(
                    outcomeOf((): unknown => (UUID as any)[generate](name, namespace, portedBuffer, start)),
                    checked((): unknown => (upstream as any)[generate](name, namespace, upstreamBuffer, start), upstreamBuffer, start),
                    `${generate} ${String(name)} ${String(namespace)}`
                )
            }
        }
    })

    it('generates the UUIDs without options as uuid: their versions, and the times of v1 and v6 in order', (): void => {
        const generated: Record<string, string[]> = {v1: [], v4: [], v6: []}
        for (let run: number = 0; run < 200; run++) for (const generate of ['v1', 'v4', 'v6'] as const) generated[generate].push((UUID as any)[generate]())
        for (const [generate, uuids] of Object.entries(generated)) {
            for (const uuid of uuids) {
                assert.ok(upstream.validate(uuid), uuid)
                assert.strictEqual(upstream.version(uuid), Number(generate.slice(1)))
            }
            assert.strictEqual(new Set(uuids).size, uuids.length)
        }
        //The v6 UUIDs sort by their time
        assert.deepStrictEqual([...generated.v6].sort(), generated.v6)
    })

    it('does not change the random bytes given to v4', (): void => {
        const random: Uint8Array = Uint8Array.from({length: 16}, (_: unknown, index: number): number => index * 17)
        const copy: Uint8Array = random.slice()
        const uuid: string = UUID.v4({random: random})
        assert.deepStrictEqual(random, copy)
        assert.strictEqual(uuid, upstream.v4({random: copy.slice()}))
        assert.strictEqual(UUID.version(uuid), 4)
    })

    it('checks the buffer before writing v3, v5 and v6 into it', (): void => {
        for (const generate of [(buf: Uint8Array, offset: number): unknown => UUID.v3('a', UUID.NIL, buf, offset),
            (buf: Uint8Array, offset: number): unknown => UUID.v5('a', UUID.NIL, buf, offset),
            (buf: Uint8Array, offset: number): unknown => UUID.v6(undefined, buf, offset)]) {
            const buf: Uint8Array = new Uint8Array(20)
            assert.throws((): unknown => generate(buf, 10), RangeError)
            assert.throws((): unknown => generate(new Uint8Array(15), 0), RangeError)
            assert.deepStrictEqual(buf, new Uint8Array(20))
            assert.strictEqual(generate(buf, 4), buf)
            assert.notDeepStrictEqual(buf, new Uint8Array(20))
        }
    })
})
