import {describe, it} from 'node:test'
import assert from 'node:assert'
import {cloneDeep} from '../exports/Utils.js'

class Point {
    constructor(public x: number, public y: number) {
    }

    public get length(): number {
        return Math.hypot(this.x, this.y)
    }
}

describe('cloneDeep', (): void => {

    it('returns the primitives as they are', (): void => {
        for (const value of [1, 'a', true, null, undefined, 10n, Symbol.for('s')]) assert.strictEqual(cloneDeep(value), value)
    })

    it('clones the objects and the arrays deeply', (): void => {
        const value: { a: number[], b: { c: { d: string } } } = {a: [1, 2], b: {c: {d: 'x'}}}
        const clone: typeof value = cloneDeep(value)
        assert.deepStrictEqual(clone, value)
        assert.notStrictEqual(clone.a, value.a)
        assert.notStrictEqual(clone.b.c, value.b.c)
        clone.b.c.d = 'y'
        assert.strictEqual(value.b.c.d, 'x')
    })

    it('keeps the prototypes of the instances', (): void => {
        const clone: Point = cloneDeep(new Point(3, 4))
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
        const clone: Record<string, any> = cloneDeep(value)
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
        const clone: Record<PropertyKey, any> = cloneDeep(value)
        assert.strictEqual(clone.self, clone)
        assert.deepStrictEqual(clone[symbol], {s: 1})
        assert.notStrictEqual(clone[symbol], value[symbol])
        assert.deepStrictEqual(clone.hidden, {h: 1})
        assert.strictEqual(Object.getOwnPropertyDescriptor(clone, 'hidden')!.enumerable, false)
        assert.strictEqual(clone.computed, 42)
        //The getter is read: its value is a property of the clone
        assert.strictEqual(Object.getOwnPropertyDescriptor(clone, 'computed')!.get, undefined)
        assert.strictEqual(Object.getOwnPropertyDescriptor(clone, 'computed')!.enumerable, true)
    })

    it('clones the value read by a getter, and copies a setter alone', (): void => {
        const nested: { v: number } = {v: 1}
        const writes: number[] = []
        const value: Record<string, any> = {
            get nested(): { v: number } {
                return nested
            },
            set sink(input: number) {
                writes.push(input)
            }
        }
        const clone: Record<string, any> = cloneDeep(value)
        assert.deepStrictEqual(clone.nested, {v: 1})
        assert.notStrictEqual(clone.nested, nested)
        clone.sink = 3
        assert.deepStrictEqual(writes, [3])
    })

    it('keeps the weak collections and the promises as they are', async (): Promise<void> => {
        const weakMap: WeakMap<object, number> = new WeakMap([[{}, 1]])
        const weakSet: WeakSet<object> = new WeakSet()
        const promise: Promise<number> = Promise.resolve(5)
        const clone: Record<string, any> = cloneDeep({weakMap: weakMap, weakSet: weakSet, promise: promise})
        assert.strictEqual(clone.weakMap, weakMap)
        assert.strictEqual(clone.weakSet, weakSet)
        assert.strictEqual(clone.promise, promise)
        assert.strictEqual(await clone.promise, 5)
    })

    it('clones the frozen, sealed and non-extensible objects as such', (): void => {
        const frozen: { a: { b: number }, list: readonly number[] } = Object.freeze({a: {b: 1}, list: Object.freeze([1, 2])})
        const clone: typeof frozen = cloneDeep(frozen)
        assert.deepStrictEqual(clone, frozen)
        assert.notStrictEqual(clone, frozen)
        assert.ok(Object.isFrozen(clone) && Object.isFrozen(clone.list))
        //The nested object was not frozen
        assert.ok(!Object.isFrozen(clone.a))
        assert.ok(Object.isSealed(cloneDeep(Object.seal({a: 1}))) && !Object.isFrozen(cloneDeep(Object.seal({a: 1}))))
        assert.ok(!Object.isExtensible(cloneDeep(Object.preventExtensions({a: 1}))))
        assert.ok(Object.isExtensible(cloneDeep({a: 1})))
        //A frozen instance keeps its class
        assert.ok(cloneDeep(Object.freeze(new Point(1, 2))) instanceof Point)
    })

    it('keeps the properties of the arrays', (): void => {
        const value: number[] & { label?: string } = [1, 2, 3]
        value.label = 'numbers'
        const clone: typeof value = cloneDeep(value)
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
        const clone: Record<string, any> = cloneDeep(value)
        assert.deepStrictEqual(clone as unknown, {nested: {list: [1, 2]}, date: new Date(5)})
        writes.length = 0
        clone.nested.list.push(3)
        clone.nested.other = true
        assert.deepStrictEqual(writes, [])
        assert.deepStrictEqual(structuredClone(clone), {nested: {list: [1, 2, 3], other: true}, date: new Date(5)})
    })

    it('clones the binary data and the boxed primitives with their data', (): void => {
        const bytes: Uint8Array = new Uint8Array([1, 2, 3])
        const floats: Float64Array = new Float64Array([1.5, -2])
        const view: Uint16Array = new Uint16Array(new Uint8Array([0, 0, 1, 0, 2, 0, 9, 9]).buffer, 2, 2)
        const buffer: ArrayBuffer = new Uint8Array([7, 8]).buffer
        const dataView: DataView = new DataView(new Uint8Array([5, 6, 7]).buffer, 1, 2)
        class Bytes extends Uint8Array {
        }
        const subclass: Bytes = new Bytes([4, 5])
        const clone = cloneDeep({bytes: bytes, floats: floats, view: view, buffer: buffer, dataView: dataView, subclass: subclass, text: new String('s'), number: new Number(5), flag: new Boolean(false)})
        assert.deepStrictEqual(Array.from(clone.bytes), [1, 2, 3])
        assert.ok(clone.bytes instanceof Uint8Array && clone.bytes !== bytes && clone.bytes.buffer !== bytes.buffer)
        assert.deepStrictEqual(Array.from(clone.floats), [1.5, -2])
        //A view keeps its elements only
        assert.deepStrictEqual(Array.from(clone.view), [1, 2])
        assert.deepStrictEqual(Array.from(new Uint8Array(clone.buffer)), [7, 8])
        assert.ok(clone.buffer !== buffer)
        assert.deepStrictEqual([clone.dataView.getUint8(0), clone.dataView.getUint8(1), clone.dataView.byteLength], [6, 7, 2])
        assert.ok(clone.subclass instanceof Bytes)
        assert.deepStrictEqual(Array.from(clone.subclass), [4, 5])
        assert.deepStrictEqual([clone.text.valueOf(), clone.number.valueOf(), clone.flag.valueOf()], ['s', 5, false])
        assert.ok(clone.text instanceof String)
        //The clone is independent
        clone.bytes[0] = 99
        assert.strictEqual(bytes[0], 1)
    })
})
