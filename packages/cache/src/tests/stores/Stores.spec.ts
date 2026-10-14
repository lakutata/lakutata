import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {Cacher, CacheStoreOptions} from '../../exports/Cache.js'

//The backends of docker-compose.test.yml
const HOST: string = process.env.CACHE_TEST_HOST ?? '127.0.0.1'

type RawAccess = {
    //Read the stored data of a backend key
    read(key: string): Promise<string | undefined>
    //Write stored data under a backend key
    write(key: string, data: string): Promise<void>
    close(): Promise<void>
}

type StoreCase = {
    options: (namespace?: string) => CacheStoreOptions
    //The backend key of a key
    key: (key: string, namespace?: string) => string
    raw: () => Promise<RawAccess>
    //Whether clearing a namespace keeps the other entries
    scopedClear: boolean
}

let directory: string

const CASES: Record<string, StoreCase> = {
    redis: {
        options: (namespace?: string): CacheStoreOptions => ({type: 'redis', host: HOST, port: 16379, namespace: namespace}),
        key: (key: string, namespace?: string): string => namespace ? `${namespace}::${namespace}:${key}` : key,
        raw: async (): Promise<RawAccess> => {
            const {createClient} = await import('redis') as any
            const client: any = createClient({socket: {host: HOST, port: 16379}})
            await client.connect()
            return {
                read: async (key: string): Promise<string | undefined> => (await client.get(key)) ?? undefined,
                write: async (key: string, data: string): Promise<void> => void await client.set(key, data),
                close: async (): Promise<void> => void await client.quit()
            }
        },
        scopedClear: true
    },
    memcache: {
        options: (namespace?: string): CacheStoreOptions => ({type: 'memcache', host: HOST, port: 11212, namespace: namespace}),
        key: (key: string, namespace?: string): string => namespace ? `${namespace}:${namespace}:${key}` : key,
        raw: async (): Promise<RawAccess> => {
            const memjs: any = (await import('memjs') as any).default
            const client: any = memjs.Client.create(`${HOST}:11212`)
            return {
                read: async (key: string): Promise<string | undefined> => (await client.get(key)).value?.toString(),
                write: async (key: string, data: string): Promise<void> => void await client.set(key, data, {}),
                close: async (): Promise<void> => client.close()
            }
        },
        scopedClear: false
    },
    mongo: {
        options: (namespace?: string): CacheStoreOptions => ({type: 'mongo', host: HOST, port: 27018, username: 'root', password: 'secret', database: 'cache', collection: 'kv', namespace: namespace}),
        key: (key: string, namespace?: string): string => namespace ? `${namespace}:${key}` : key,
        raw: async (): Promise<RawAccess> => {
            const {MongoClient} = await import('mongodb') as any
            const client: any = new MongoClient(`mongodb://root:secret@${HOST}:27018`)
            await client.connect()
            const collection: any = client.db('cache').collection('kv')
            return {
                read: async (key: string): Promise<string | undefined> => (await collection.findOne({key: key}))?.value,
                write: async (key: string, data: string): Promise<void> => void await collection.updateOne({key: key}, {$set: {key: key, value: data, expiresAt: null}}, {upsert: true}),
                close: (): Promise<void> => client.close()
            }
        },
        scopedClear: true
    },
    mysql: {
        options: (namespace?: string): CacheStoreOptions => ({type: 'mysql', host: HOST, port: 13306, username: 'root', password: 'secret', database: 'cache', table: 'kv', namespace: namespace}),
        key: (key: string, namespace?: string): string => namespace ? `${namespace}:${key}` : key,
        raw: async (): Promise<RawAccess> => {
            const mysql: any = (await import('mysql2/promise') as any).default
            const connection: any = await mysql.createConnection({host: HOST, port: 13306, user: 'root', password: 'secret', database: 'cache'})
            return {
                read: async (key: string): Promise<string | undefined> => (await connection.query('SELECT value FROM kv WHERE id = ?', [key]))[0][0]?.value,
                write: async (key: string, data: string): Promise<void> => void await connection.query('REPLACE INTO kv (id, value) VALUES (?, ?)', [key, data]),
                close: (): Promise<void> => connection.end()
            }
        },
        scopedClear: true
    },
    postgres: {
        options: (namespace?: string): CacheStoreOptions => ({type: 'postgres', host: HOST, port: 15432, username: 'postgres', password: 'secret', database: 'cache', table: 'kv', namespace: namespace}),
        key: (key: string, namespace?: string): string => namespace ? `${namespace}:${key}` : key,
        raw: async (): Promise<RawAccess> => {
            const pg: any = (await import('pg') as any).default
            const client: any = new pg.Client({host: HOST, port: 15432, user: 'postgres', password: 'secret', database: 'cache'})
            await client.connect()
            return {
                read: async (key: string): Promise<string | undefined> => (await client.query('SELECT value FROM kv WHERE key = $1', [key])).rows[0]?.value,
                write: async (key: string, data: string): Promise<void> => void await client.query('INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, data]),
                close: (): Promise<void> => client.end()
            }
        },
        scopedClear: true
    },
    sqlite: {
        options: (namespace?: string): CacheStoreOptions => ({type: 'sqlite', database: path.join(directory, 'cache.sqlite'), table: 'kv', namespace: namespace}),
        key: (key: string, namespace?: string): string => namespace ? `${namespace}:${key}` : key,
        raw: async (): Promise<RawAccess> => {
            const Database: any = (await import('better-sqlite3') as any).default
            const database: any = new Database(path.join(directory, 'cache.sqlite'))
            return {
                read: async (key: string): Promise<string | undefined> => database.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value,
                write: async (key: string, data: string): Promise<void> => void database.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, data),
                close: async (): Promise<void> => database.close()
            }
        },
        scopedClear: true
    }
}

/**
 * Wait
 * @param ms
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, ms))
}

/**
 * Create a cacher in its own container
 * @param options
 */
async function open(options: CacheStoreOptions): Promise<{ cacher: Cacher, close: () => Promise<void> }> {
    const container: Container = new Container()
    const cacher: Cacher = await container.set(Cacher, {stores: options})
    return {cacher: cacher, close: (): Promise<void> => container.destroy()}
}

const VALUES: Record<string, unknown> = {
    str: 'hello',
    colon: ':colon',
    num: 42,
    obj: {a: 1, b: [1, 'x', null], c: {d: ':e'}},
    buf: Buffer.from('bin'),
    bool: false,
    nul: null,
    unicode: '中文😀'
}

describe('Cache stores', {skip: !process.env.CACHE_TEST_STORES && 'set CACHE_TEST_STORES=1 with the backends of docker-compose.test.yml'}, (): void => {

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'cacher-stores-'))
    })

    after(async (): Promise<void> => {
        await rm(directory, {recursive: true, force: true})
    })

    for (const [name, store] of Object.entries(CASES)) {
        describe(name, (): void => {

            it('stores the values', async (): Promise<void> => {
                const {cacher, close} = await open(store.options('values'))
                await cacher.clear()
                for (const [key, value] of Object.entries(VALUES)) await cacher.set(key, value)
                for (const [key, value] of Object.entries(VALUES)) assert.deepStrictEqual(await cacher.get(key), value, key)
                assert.deepStrictEqual(await cacher.multipleGet(['str', 'missing', 'num']), ['hello', undefined, 42])
                await cacher.multipleSet([{key: 'm1', value: 1}, {key: 'm2', value: 2, ttl: 60000}, {key: 'm1', value: 3}])
                assert.deepStrictEqual(await cacher.multipleGet(['m1', 'm2']), [3, 2])
                assert.ok(await cacher.getTTL('m2') > Date.now())
                assert.ok(await cacher.del('str'))
                assert.strictEqual(await cacher.get('str'), undefined)
                await cacher.multipleDel(['m1', 'm2'])
                assert.deepStrictEqual(await cacher.multipleGet(['m1', 'm2']), [undefined, undefined])
                await close()
            })

            it('expires the entries', async (): Promise<void> => {
                const {cacher, close} = await open(store.options('ttl'))
                await cacher.set('short', 1, 200)
                await cacher.set('long', 2, 60000)
                assert.strictEqual(await cacher.get('short'), 1)
                await sleep(300)
                assert.strictEqual(await cacher.get('short'), undefined)
                assert.strictEqual(await cacher.get('long'), 2)
                await close()
            })

            it('keeps the format of 2.x', async (): Promise<void> => {
                const raw: RawAccess = await store.raw()
                const {cacher, close} = await open(store.options('compat'))
                //Written by 2.x
                await raw.write(store.key('old', 'compat'), '{"value":{"s":"::a","b":":base64:Ymlu"}}')
                await raw.write(store.key('expired', 'compat'), '{"value":1,"expires":1}')
                assert.deepStrictEqual(await cacher.get('old'), {s: ':a', b: Buffer.from('bin')})
                assert.strictEqual(await cacher.get('expired'), undefined)
                //Read by 2.x
                await cacher.set('new', {s: ':a', b: Buffer.from('bin')})
                assert.strictEqual(await raw.read(store.key('new', 'compat')), '{"value":{"s":"::a","b":":base64:Ymlu"}}')
                await cacher.set('plain', 'x', 60000)
                assert.match((await raw.read(store.key('plain', 'compat')))!, /^\{"value":"x","expires":\d+}$/)
                await close()
                const plain = await open(store.options())
                await plain.cacher.set('bare', 1)
                assert.strictEqual(await raw.read(store.key('bare')), '{"value":1}')
                await plain.close()
                await raw.close()
            })

            it('clears the namespaces', async (): Promise<void> => {
                const first = await open(store.options('first'))
                const second = await open(store.options('second_%'))
                const bare = await open(store.options())
                await first.cacher.set('k', 1)
                await second.cacher.set('k', 2)
                await bare.cacher.set('k', 3)
                await first.cacher.clear()
                assert.strictEqual(await first.cacher.get('k'), undefined)
                if (store.scopedClear) {
                    assert.strictEqual(await second.cacher.get('k'), 2)
                    assert.strictEqual(await bare.cacher.get('k'), 3)
                    await bare.cacher.clear()
                    assert.strictEqual(await bare.cacher.get('k'), undefined)
                }
                await first.close()
                //Another cacher on the same backend keeps working
                assert.ok([2, undefined].includes(await second.cacher.get('k')))
                await second.close()
                await bare.close()
            })
        })
    }
})
