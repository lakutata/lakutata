import {describe, it} from 'node:test'
import assert from 'node:assert'
import upstreamIsGlob from 'is-glob'
import {isGlobString} from '../exports/Utils.js'

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

const random: () => number = Random(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

/**
 * A random string of the characters of the globs, their escapes and other characters
 */
function Candidate(): string {
    const pieces: string[] = ['a', 'b', '/', '.', '*', '**', '?', '!', '@', '+', '[', ']', '{', '}', '(', ')', '|', ',', '\\', '\\*', '\\[', '\\{', '\\(', '-', ':', '=', '^', '$', '.js', 'dir/', '!(x)', '@(a|b)', '+(y)', '?(z)', '*(w)', '[abc]', '{a,b}', '(?:x)', '(a|b)', ' ']
    return Array.from({length: Math.floor(random() * 7)}, (): string => pick(pieces)).join('')
}

describe('isGlobString', (): void => {

    it('recognizes the globs as is-glob, and the ? wildcard of Glob anywhere', (): void => {
        const counts: Record<string, number> = {true: 0, false: 0}
        for (let run: number = 0; run < 20000; run++) {
            const candidate: string = Candidate()
            //is-glob only sees a ? after ], ., + or )
            const expected: boolean = upstreamIsGlob(candidate) || candidate.replace(/\\./g, '').includes('?')
            assert.strictEqual(isGlobString(candidate), expected, JSON.stringify(candidate))
            counts[String(expected)]++
        }
        assert.ok(counts.true > 5000 && counts.false > 2000, JSON.stringify(counts))
        for (const value of [undefined, null, 5, ''] as any[]) assert.strictEqual(isGlobString(value), upstreamIsGlob(value))
    })

    it('recognizes the ? wildcard as Glob does', (): void => {
        for (const pattern of ['a?b', '?', 'file?.txt', 'src/?/x']) assert.strictEqual(isGlobString(pattern), true, pattern)
        for (const literal of ['a\\?b', 'src/index.ts', 'a.b']) assert.strictEqual(isGlobString(literal), false, literal)
    })
})
