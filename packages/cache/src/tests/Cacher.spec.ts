import {describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {Cacher, CacheDriverNotFoundException} from '../exports/Cache.js'
import {Deserialize, Serialize} from '../cache/lib/Serializer.js'
import {LoadDriver} from '../cache/lib/LoadDriver.js'

/**
 * Wait
 * @param ms
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, ms))
}

/**
 * Run a test in a temporary directory
 * @param fn
 */
async function inDirectory(fn: (directory: string) => Promise<void>): Promise<void> {
    const directory: string = await mkdtemp(path.join(tmpdir(), 'cacher-'))
    try {
        await fn(directory)
    } finally {
        await rm(directory, {recursive: true, force: true})
    }
}

describe('Cacher', (): void => {

    it('caches in memory', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher)
        const value: { x: number } = {x: 1}
        await cacher.set('a', value)
        assert.strictEqual(await cacher.get('a'), value)
        await cacher.multipleSet([{key: 'b', value: 2}, {key: 'c', value: 3}])
        assert.deepStrictEqual(await cacher.multipleGet(['b', 'c', 'missing']), [2, 3, undefined])
        assert.ok(await cacher.del('a'))
        assert.strictEqual(await cacher.get('a'), undefined)
        await cacher.multipleDel(['b'])
        assert.deepStrictEqual(await cacher.multipleGet(['b', 'c']), [undefined, 3])
        await cacher.clear()
        assert.strictEqual(await cacher.get('c'), undefined)
        await container.destroy()
    })

    it('expires the entries', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher, {ttl: 50})
        await cacher.set('a', 1)
        await cacher.set('b', 2, 0)
        assert.strictEqual(await cacher.get('a'), 1)
        const expires: number = await cacher.getTTL('a')
        assert.ok(expires > Date.now() && expires <= Date.now() + 50)
        assert.strictEqual(await cacher.getTTL('b'), -1)
        await sleep(80)
        assert.strictEqual(await cacher.get('a'), undefined)
        assert.strictEqual(await cacher.getTTL('a'), -1)
        assert.strictEqual(await cacher.get('b'), 2)
        await container.destroy()
    })

    it('emits the events', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher)
        const events: string[] = []
        cacher.on('set', (data): unknown => events.push(`set:${data.key}`))
        cacher.on('del', (data): unknown => events.push(`del:${data.key}`))
        cacher.on('clear', (): unknown => events.push('clear'))
        await cacher.set('a', 1)
        await cacher.del('a')
        await cacher.clear()
        //The listeners of on() are called after the emitting (as 2.x)
        await new Promise((resolve: (value?: unknown) => void): unknown => setImmediate(resolve))
        assert.deepStrictEqual(events, ['set:a', 'del:a', 'clear'])
        await container.destroy()
    })

    it('wraps a computation', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher)
        let calls: number = 0
        const compute = async (): Promise<number> => {
            await sleep(10)
            return ++calls
        }
        //The concurrent calls share one computation
        assert.deepStrictEqual(await Promise.all([cacher.wrap('k', compute), cacher.wrap('k', compute)]), [1, 1])
        assert.strictEqual(await cacher.wrap('k', compute), 1)
        assert.strictEqual(calls, 1)
        //The ttl can depend on the value
        assert.strictEqual(await cacher.wrap('short', (): string => 'v', {ttl: (value: string): number => value.length * 30}), 'v')
        await sleep(50)
        assert.strictEqual(await cacher.get('short'), undefined)
        //A failed computation is not cached
        await assert.rejects(cacher.wrap('fail', (): never => {
            throw new Error('failure')
        }), {message: 'failure'})
        assert.strictEqual(await cacher.wrap('fail', (): number => 2), 2)
        await container.destroy()
    })

    it('refreshes a wrapped value close to its expiration', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher, {ttl: 100, refreshThreshold: 60})
        let version: number = 0
        const refreshed: number[] = []
        cacher.on('refresh', (data): unknown => refreshed.push(data.value))
        assert.strictEqual(await cacher.wrap('k', (): number => ++version), 1)
        assert.strictEqual(await cacher.wrap('k', (): number => ++version), 1)
        await sleep(60)
        //The stale value is returned while it is recomputed in the background
        assert.strictEqual(await cacher.wrap('k', (): number => ++version), 1)
        await sleep(10)
        assert.deepStrictEqual(refreshed, [2])
        assert.strictEqual(await cacher.get('k'), 2)
        await container.destroy()
    })

    it('reads through the stores in order', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher, {
            stores: [
                {type: 'file', filename: path.join(directory, 'l1.json'), writeDelay: 0},
                {type: 'file', filename: path.join(directory, 'l2.json'), writeDelay: 0, namespace: 'l2'}
            ]
        })
        await cacher.set('a', 'both', 1000)
        assert.strictEqual(await cacher.get('a'), 'both')
        await container.destroy()
        //Remove the entry from the first store only
        const l1: string = path.join(directory, 'l1.json')
        const content: { cache: [string, unknown][] } = Deserialize(await readFile(l1, 'utf8'))
        await writeFile(l1, Serialize({cache: content.cache.filter(([key]): boolean => key !== 'a'), lastExpire: Date.now()}))
        const reopened: Container = new Container()
        const tiers: Cacher = await reopened.set(Cacher, {
            stores: [
                {type: 'file', filename: l1, writeDelay: 0},
                {type: 'file', filename: path.join(directory, 'l2.json'), writeDelay: 0, namespace: 'l2'}
            ]
        })
        assert.strictEqual(await tiers.get('a'), 'both')
        assert.deepStrictEqual(await tiers.multipleGet(['a', 'b']), ['both', undefined])
        //A wrap copies the value to the first store, until it expires in the second
        const expires: number = await tiers.getTTL('a')
        assert.strictEqual(await tiers.wrap('a', (): string => 'computed'), 'both')
        await reopened.destroy()
        const first: { cache: [string, { expire?: number }][] } = Deserialize(await readFile(l1, 'utf8'))
        const copied: number = first.cache.find(([key]): boolean => key === 'a')![1].expire!
        assert.ok(Math.abs(copied - expires) < 50)
    }))

    it('caches in files, in the format of 2.x', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const filename: string = path.join(directory, 'cache.json')
        //A file written by 2.x
        await writeFile(filename, '{"cache":[["ns:str",{"value":"{\\"value\\":\\"::colon\\"}"}],["ns:buf",{"value":"{\\"value\\":\\":base64:Ymlu\\"}"}],["ns:old",{"expire":1,"value":"{\\"value\\":1,\\"expires\\":1}"}],["other",{"value":"{\\"value\\":1}"}]],"lastExpire":1}')
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher, {stores: {type: 'file', filename: filename, writeDelay: 0, namespace: 'ns'}})
        assert.strictEqual(await cacher.get('str'), ':colon')
        assert.deepStrictEqual(await cacher.get('buf'), Buffer.from('bin'))
        assert.strictEqual(await cacher.get('old'), undefined)
        await cacher.set('obj', {a: [':b']})
        await cacher.clear()
        await cacher.set('new', 1)
        await container.destroy()
        //Clearing a namespace keeps the other entries
        const content: { cache: [string, { value: string }][] } = JSON.parse(await readFile(filename, 'utf8'))
        assert.deepStrictEqual(content.cache, [['other', {value: '{"value":1}'}], ['ns:new', {value: '{"value":1}'}]])
    }))

    it('reports the missing drivers', async (): Promise<void> => {
        await assert.rejects(LoadDriver('createClient', 'lakutata-missing-driver'), (error: Error): boolean => error instanceof CacheDriverNotFoundException && error.message.includes('npm install lakutata-missing-driver'))
    })
})

describe('Cache serializer', (): void => {

    it('writes the format of 2.x', (): void => {
        const cases: [unknown, string][] = [
            [{value: 'hello'}, '{"value":"hello"}'],
            [{value: ':colon'}, '{"value":"::colon"}'],
            [{value: {a: 1, b: [1, 'x', null], c: {d: ':e'}, u: undefined}}, '{"value":{"a":1,"b":[1,"x",null],"c":{"d":"::e"}}}'],
            [{value: [1, 2, {x: ':y'}]}, '{"value":[1,2,{"x":"::y"}]}'],
            [{value: new Date('2020-01-02T03:04:05.000Z')}, '{"value":"2020-01-02T03:04:05.000Z"}'],
            [{value: Buffer.from('bin')}, '{"value":":base64:Ymlu"}'],
            [{value: null, expires: 5}, '{"value":null,"expires":5}'],
            [{value: 'expiring', expires: undefined}, '{"value":"expiring"}']
        ]
        for (const [data, text] of cases) assert.strictEqual(Serialize(data), text)
    })

    it('round trips the values', (): void => {
        const values: unknown[] = ['', ':', '::a', ':base64:', 'a:b', {':key': ':v'}, [':a', [':b']], Buffer.from([0, 255]), {nested: {buffer: Buffer.from('x')}}, 1.5, true, null]
        for (const value of values) assert.deepStrictEqual(Deserialize(Serialize({value: value})), {value: value}, JSON.stringify(value))
        //Formatted documents are read too
        assert.deepStrictEqual(Deserialize('{ "value" : [ "::a" ] }'), {value: [':a']})
    })
})
