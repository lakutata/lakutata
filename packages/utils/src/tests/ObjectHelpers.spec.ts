import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Delay, GetObjectNestingDepth, GetObjectPropertyPaths, ObjectToMap, SortKeys, SortObject} from '../exports/Utils.js'

describe('Object helpers', (): void => {

    it('measures the nesting depth with null values and cycles', (): void => {
        assert.strictEqual(GetObjectNestingDepth({}), 0)
        assert.strictEqual(GetObjectNestingDepth({a: {b: {c: 1}}}), 3)
        assert.strictEqual(GetObjectNestingDepth({a: null, b: {c: null}}), 2)
        const cyclic: Record<string, any> = {a: {b: 1}}
        cyclic.a.self = cyclic
        cyclic.me = cyclic
        assert.strictEqual(GetObjectNestingDepth(cyclic), 2)
        //An object referenced twice, not circularly, counts at each place
        const shared: Record<string, any> = {x: {y: 1}}
        assert.strictEqual(GetObjectNestingDepth({a: shared, b: {c: shared}}), 4)
    })

    it('lists the property paths with null values and cycles', (): void => {
        assert.deepStrictEqual(GetObjectPropertyPaths({a: 1, b: {c: 2, d: {e: 3}}, list: [4, 5], none: null}), ['a', 'b.c', 'b.d.e', 'list.0', 'list.1', 'none'])
        const cyclic: Record<string, any> = {a: {b: 1}}
        cyclic.a.self = cyclic
        assert.deepStrictEqual(GetObjectPropertyPaths(cyclic, 'root'), ['root.a.b', 'root.a.self'])
        const shared: Record<string, any> = {y: 1}
        assert.deepStrictEqual(GetObjectPropertyPaths({a: shared, b: shared}), ['a.y', 'b.y'])
    })

    it('copies the getters and setters when sorting the keys', (): void => {
        let reads: number = 0
        const source: Record<string, any> = {
            b: 1,
            get a(): number {
                reads++
                return 2
            },
            set c(value: number) {
                this.b = value
            }
        }
        const sorted: Record<string, any> = SortKeys(source)
        assert.strictEqual(reads, 0)
        assert.deepStrictEqual(Object.keys(sorted), ['a', 'b', 'c'])
        assert.strictEqual(typeof Object.getOwnPropertyDescriptor(sorted, 'a')!.get, 'function')
        assert.strictEqual(sorted.a, 2)
        sorted.c = 5
        assert.strictEqual(sorted.b, 5)
        assert.deepStrictEqual(Object.keys(SortObject(source, {deep: true, order: 'desc'})), ['c', 'b', 'a'])
    })

    it('converts an object into a map keyed by strings', (): void => {
        const map: Map<'1' | 'b', string> = ObjectToMap({1: 'a', b: 'c'})
        assert.deepStrictEqual([...map], [['1', 'a'], ['b', 'c']])
        const settings: Map<string, number> = ObjectToMap({retries: 3})
        assert.strictEqual(settings.get('retries'), 3)
    })

    it('waits for no time with a negative or NaN delay, without warning', async (): Promise<void> => {
        const warnings: Error[] = []
        const listener = (warning: Error): number => warnings.push(warning)
        process.on('warning', listener)
        try {
            const start: number = Date.now()
            await Delay(-5)
            await Delay(NaN)
            assert.ok(Date.now() - start < 50)
            await Delay(0)
            //The warnings are emitted on the next tick
            await new Promise((resolve: (value: unknown) => void): unknown => setImmediate(resolve))
            assert.deepStrictEqual(warnings.map((warning: Error): string => warning.name), [])
        } finally {
            process.off('warning', listener)
        }
    })
})
