import {describe, it} from 'node:test'
import assert from 'node:assert'
import {CloneDeep} from '../exports/Helpers.js'

class Point {
    constructor(public x: number, public y: number) {
    }

    public get length(): number {
        return Math.hypot(this.x, this.y)
    }
}

describe('CloneDeep', (): void => {

    it('returns the primitives as they are', (): void => {
        for (const value of [1, 'a', true, null, undefined, 10n, Symbol.for('s')]) assert.strictEqual(CloneDeep(value), value)
    })

    it('clones the objects and the arrays deeply', (): void => {
        const value: { a: number[], b: { c: { d: string } } } = {a: [1, 2], b: {c: {d: 'x'}}}
        const clone: typeof value = CloneDeep(value)
        assert.deepStrictEqual(clone, value)
        assert.notStrictEqual(clone.a, value.a)
        assert.notStrictEqual(clone.b.c, value.b.c)
        clone.b.c.d = 'y'
        assert.strictEqual(value.b.c.d, 'x')
    })

    it('keeps the prototypes of the instances', (): void => {
        const clone: Point = CloneDeep(new Point(3, 4))
        assert.ok(clone instanceof Point)
        assert.strictEqual(clone.length, 5)
    })

    it('clones the built-in types as such', (): void => {
        const value: Record<string, any> = {
            date: new Date(1000),
            regex: /a+/gi,
            url: new URL('https://lakutata.com/a?b=1'),
            buffer: Buffer.from('abc'),
            map: new Map<string, object>([['k', {v: 1}]]),
            set: new Set<object>([{v: 2}]),
            error: new TypeError('failure')
        }
        const clone: Record<string, any> = CloneDeep(value)
        assert.ok(clone.date instanceof Date && clone.date.getTime() === 1000 && clone.date !== value.date)
        assert.ok(clone.regex instanceof RegExp && clone.regex.source === 'a+' && clone.regex.flags === 'gi')
        assert.ok(clone.url instanceof URL && clone.url.href === value.url.href && clone.url !== value.url)
        assert.ok(Buffer.isBuffer(clone.buffer) && clone.buffer.toString() === 'abc' && clone.buffer !== value.buffer)
        assert.deepStrictEqual(clone.map.get('k'), {v: 1})
        assert.notStrictEqual(clone.map.get('k'), value.map.get('k'))
        assert.deepStrictEqual([...clone.set], [{v: 2}])
        assert.notStrictEqual([...clone.set][0], [...value.set][0])
        assert.ok(clone.error instanceof TypeError && clone.error.message === 'failure' && clone.error !== value.error)
        assert.strictEqual(clone.error.stack, value.error.stack)
    })

    it('keeps the circular references, the symbol properties, the accessors and the non enumerable properties', (): void => {
        const symbol: unique symbol = Symbol('key')
        const value: Record<PropertyKey, any> = {[symbol]: {s: 1}}
        value.self = value
        Object.defineProperty(value, 'hidden', {value: {h: 1}, enumerable: false, writable: true, configurable: true})
        Object.defineProperty(value, 'computed', {get(): number {
            return 42
        }, enumerable: true, configurable: true})
        const clone: Record<PropertyKey, any> = CloneDeep(value)
        assert.strictEqual(clone.self, clone)
        assert.deepStrictEqual(clone[symbol], {s: 1})
        assert.notStrictEqual(clone[symbol], value[symbol])
        assert.deepStrictEqual(clone.hidden, {h: 1})
        assert.strictEqual(Object.getOwnPropertyDescriptor(clone, 'hidden')!.enumerable, false)
        assert.strictEqual(clone.computed, 42)
    })

    it('keeps the properties of the arrays', (): void => {
        const value: number[] & { label?: string } = [1, 2, 3]
        value.label = 'numbers'
        const clone: typeof value = CloneDeep(value)
        assert.ok(Array.isArray(clone))
        assert.deepStrictEqual([...clone], [1, 2, 3])
        assert.strictEqual(clone.label, 'numbers')
    })

    it('clones the proxies as the objects they expose, the clones are not proxies', (): void => {
        const writes: string[] = []
        const proxy = (target: object): any => new Proxy(target, {
            set(object: any, key: string | symbol, newValue: any): boolean {
                writes.push(String(key))
                return Reflect.set(object, key, newValue)
            }
        })
        const value: Record<string, any> = proxy({nested: proxy({list: proxy([1, 2])}), date: new Date(5)})
        const clone: Record<string, any> = CloneDeep(value)
        assert.deepStrictEqual(clone as unknown, {nested: {list: [1, 2]}, date: new Date(5)})
        writes.length = 0
        clone.nested.list.push(3)
        clone.nested.other = true
        assert.deepStrictEqual(writes, [])
        assert.deepStrictEqual(structuredClone(clone), {nested: {list: [1, 2, 3], other: true}, date: new Date(5)})
    })
})
