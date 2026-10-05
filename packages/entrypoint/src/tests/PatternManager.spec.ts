import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Patrun} from 'patrun'
import {PatternManager} from '../lib/pattern/PatternManager.js'
import {GlobPattern} from '../lib/pattern/GlobPattern.js'

/**
 * A pseudo-random generator with a seed: the failures are reproduced
 * @param seed
 */
function seededRandom(seed: number): () => number {
    let state: number = seed >>> 0
    return (): number => {
        state = (state + 0x6D2B79F5) >>> 0
        let value: number = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

const KEYS: string[] = ['a', 'b', 'c', 'cmd', 'role']
const VALUES: unknown[] = ['x', 'y', 'z', '1', '2', 'x*', '*', '?', 'x?', '*z', '', 'true', 'a.b', '**', '*?', 'x**', 1, 2, true]
const SUBJECT_VALUES: unknown[] = ['x', 'y', 'z', '1', '2', 'xy', 'xz', 'yz', '', 'a.b', 'aXb', '*', '?', 'x*', 1, 2, 12, true, false, undefined, null, ['x'], [], {x: 1}, {}]

/**
 * The results of a list, compared without the order of the patterns of a same value
 * @param results
 */
function listed(results: { match: Record<string, any>, data: any }[]): string[] {
    return results.map(({match, data}): string => `${JSON.stringify(match)} → ${data}`)
}

describe('The patterns of the actions', (): void => {

    it('match as patrun, from which they are rewritten', (): void => {
        for (let trial: number = 0; trial < 600; trial++) {
            const random: () => number = seededRandom(trial + 1)
            const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]
            const globMatch: boolean = trial % 5 !== 0
            const patterns: PatternManager = new PatternManager({globMatch: globMatch})
            const upstream = Patrun({gex: globMatch})
            const added: Record<string, any>[] = []
            for (let index: number = 0, count: number = 1 + Math.floor(random() * 25); index < count; index++) {
                const pattern: Record<string, any> = {}
                for (let keyIndex: number = 0, keys: number = Math.floor(random() * 4); keyIndex < keys; keyIndex++) pattern[pick(KEYS)] = random() < 0.05 ? null : pick(VALUES)
                const data: string = `p${index}`
                patterns.add(pattern, data)
                upstream.add(pattern, data)
                added.push(pattern)
            }
            //Some of them are removed
            for (const pattern of added) {
                if (random() < 0.15) {
                    patterns.remove(pattern)
                    upstream.remove(pattern)
                }
            }
            for (let index: number = 0; index < 60; index++) {
                const subject: Record<string, any> = {}
                for (let keyIndex: number = 0, keys: number = Math.floor(random() * 6); keyIndex < keys; keyIndex++) subject[random() < 0.8 ? pick(KEYS) : `extra${keyIndex}`] = pick(SUBJECT_VALUES)
                const context: string = `trial ${trial}, patterns ${JSON.stringify(added)}, subject ${JSON.stringify(subject)}`
                assert.strictEqual(patterns.find(subject), upstream.find(subject), `find, ${context}`)
                assert.strictEqual(patterns.find(subject, true), upstream.find(subject, true), `find exact, ${context}`)
            }
            for (let index: number = 0; index < 10; index++) {
                const partial: Record<string, any> = {}
                for (let keyIndex: number = 0, keys: number = Math.floor(random() * 3); keyIndex < keys; keyIndex++) partial[pick(KEYS)] = pick(['x', 'y', '*', 'x*', '1', '?'])
                const context: string = `trial ${trial}, patterns ${JSON.stringify(added)}, partial ${JSON.stringify(partial)}`
                assert.deepStrictEqual(listed(patterns.list(partial)), listed(upstream.list(partial)), `list, ${context}`)
                assert.deepStrictEqual(listed(patterns.list(partial, true)), listed(upstream.list(partial, true)), `list exact, ${context}`)
            }
        }
    })

    it('route the actions as their patterns and their prefixes are declared', (): void => {
        const patterns: PatternManager = new PatternManager()
            .add({cmd: 'greet'}, 'greet')
            .add({cmd: 'greet', role: 'admin'}, 'greet admin')
            .add({service: 'user', cmd: 'get'}, 'user get')
            .add({cmd: 'files*'}, 'files')
            .add({cmd: 'files.remove'}, 'files remove')
        //The most specific pattern, the unknown properties of the subject ignored
        assert.strictEqual(patterns.find({cmd: 'greet', name: 'you'}), 'greet')
        assert.strictEqual(patterns.find({cmd: 'greet', role: 'admin', name: 'you'}), 'greet admin')
        assert.strictEqual(patterns.find({cmd: 'greet', role: 'user'}), 'greet')
        assert.strictEqual(patterns.find({service: 'user', cmd: 'get', id: 1}), 'user get')
        //A value before a glob
        assert.strictEqual(patterns.find({cmd: 'files.list'}), 'files')
        assert.strictEqual(patterns.find({cmd: 'files.remove'}), 'files remove')
        assert.strictEqual(patterns.find({cmd: 'unknown'}), null)
        //Exact: every property of the subject is in the pattern
        assert.strictEqual(patterns.find({cmd: 'greet', name: 'you'}, true), null)
        assert.strictEqual(patterns.find({cmd: 'greet'}, true), 'greet')
        //The values are compared as strings
        assert.strictEqual(new PatternManager().add({version: 2}, 'v2').find({version: '2'}), 'v2')
        //Without globs, "*" is a value
        const values: PatternManager = new PatternManager({globMatch: false}).add({cmd: 'files*'}, 'files')
        assert.strictEqual(values.find({cmd: 'files.list'}), null)
        assert.strictEqual(values.find({cmd: 'files*'}), 'files')
        //Removed
        patterns.remove({cmd: 'greet', role: 'admin'})
        assert.strictEqual(patterns.find({cmd: 'greet', role: 'admin'}), 'greet')
        assert.deepStrictEqual(patterns.list({cmd: 'greet'}).map(({data}): string => data), ['greet'])
    })

    it('match the values named as the properties of the objects as the other values', (): void => {
        const patterns: PatternManager = new PatternManager().add({cmd: 'greet'}, 'greet')
        for (const cmd of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) assert.strictEqual(patterns.find({cmd: cmd}), null, cmd)
        //Their patterns neither change Object (patrun sets its data on Object.prototype.constructor)
        const named: PatternManager = new PatternManager().add({cmd: 'constructor'}, 'constructor').add({cmd: 'toString'}, 'toString')
        assert.strictEqual(named.find({cmd: 'constructor'}), 'constructor')
        assert.strictEqual(named.find({cmd: 'toString'}), 'toString')
        assert.strictEqual(named.find({cmd: 'valueOf'}), null)
        assert.strictEqual((Object as any).d, undefined)
    })

    it('read the globs as gex does', (): void => {
        const glob = (pattern: string, value: unknown): boolean => new GlobPattern(pattern).matches(value)
        assert.ok(glob('files*', 'files.list') && glob('files*', 'files') && !glob('files*', 'file'))
        assert.ok(glob('x?z', 'xyz') && !glob('x?z', 'xz'))
        assert.ok(glob('*', 'multi\nline'))
        //"**" and "*?" are the literal "*" and "?"
        assert.ok(glob('a**b', 'a*b') && !glob('a**b', 'axb'))
        assert.ok(glob('a*?b', 'a?b') && !glob('a*?b', 'axb'))
        //The characters of the regular expressions are literal
        assert.ok(glob('a.b*', 'a.bc') && !glob('a.b*', 'aXbc'))
        //The primitives as strings; the arrays and the objects are always matched, missing values never
        assert.ok(glob('1*', 12) && glob('t*', true))
        assert.ok(glob('x*', ['y']) && glob('x*', {}))
        assert.ok(!glob('*', undefined) && !glob('*', null))
    })
})
