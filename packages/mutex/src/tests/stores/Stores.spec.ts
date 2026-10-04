import {describe, it} from 'node:test'
import assert from 'node:assert'
import {setTimeout as sleep} from 'node:timers/promises'
import {Container} from '@lakutata/core'
import {Mutex, MutexLock, MutexLostException, MysqlMutexDriver, PostgresMutexDriver, RedisMutexDriver, type MutexDriver, type MutexDriverOptions} from '../../exports/Mutex.js'

/**
 * The stores of the tests (test-env/run.sh): their connections given by the environment
 */
const REDIS: string | undefined = process.env.MUTEX_TEST_REDIS
const POSTGRES: string | undefined = process.env.MUTEX_TEST_POSTGRES
const MYSQL: string | undefined = process.env.MUTEX_TEST_MYSQL

type Store = { title: string, driver: MutexDriverOptions, expiring: boolean, fenced: boolean, raw: () => MutexDriver, kill?: () => Promise<void> }

const stores: Store[] = []
if (REDIS) {
    stores.push({title: 'redis', driver: {type: 'redis', url: REDIS}, expiring: true, fenced: true, raw: (): MutexDriver => new RedisMutexDriver({url: REDIS}, 'lakutata:mutex:')})
}
if (POSTGRES) {
    const url: URL = new URL(POSTGRES)
    const connection = {host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), username: url.username, password: url.password}
    const kill = async (): Promise<void> => {
        const pg = await import('pg')
        const admin = new pg.default.Client({host: connection.host, port: connection.port, database: connection.database, user: connection.username, password: connection.password})
        await admin.connect()
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [connection.database])
        await admin.end()
    }
    for (const mode of ['advisory', 'table'] as const) {
        stores.push({title: `postgres ${mode}`, driver: {type: 'postgres', ...connection, mode: mode}, expiring: mode === 'table', fenced: mode === 'table', raw: (): MutexDriver => new PostgresMutexDriver(connection, 'lakutata:mutex:', mode), kill: mode === 'advisory' ? kill : undefined})
    }
}
if (MYSQL) {
    const url: URL = new URL(MYSQL)
    const connection = {host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), username: url.username, password: url.password}
    const kill = async (): Promise<void> => {
        const mysql = await import('mysql2/promise')
        const admin = await mysql.createConnection({host: connection.host, port: connection.port, database: connection.database, user: connection.username, password: connection.password})
        const [rows] = await admin.query('SELECT ID FROM information_schema.PROCESSLIST WHERE DB = ? AND ID <> CONNECTION_ID()', [connection.database]) as any
        for (const row of rows) await admin.query(`KILL ${Number(row.ID)}`).catch((): undefined => undefined)
        await admin.end()
    }
    for (const mode of ['advisory', 'table'] as const) {
        stores.push({title: `mysql ${mode}`, driver: {type: 'mysql', ...connection, mode: mode}, expiring: mode === 'table', fenced: mode === 'table', raw: (): MutexDriver => new MysqlMutexDriver(connection, 'lakutata:mutex:', mode), kill: mode === 'advisory' ? kill : undefined})
    }
}

/**
 * Two instances of an application: their components of the locks, their connections
 * @param store
 * @param options
 */
async function Instances(store: Store, options: Record<string, unknown> = {}): Promise<{ first: Mutex, second: Mutex, destroy: () => Promise<void> }> {
    const containers: Container[] = [new Container(), new Container()]
    const [first, second] = await Promise.all(containers.map((container: Container): Promise<Mutex> => container.set(Mutex, {driver: store.driver, retryDelay: 10, ...options})))
    return {first: first, second: second, destroy: async (): Promise<void> => void await Promise.all(containers.map((container: Container): Promise<void> => container.destroy()))}
}

describe('The locks of the stores', {skip: !stores.length && 'test-env/run.sh runs them with Redis, PostgreSQL and MySQL'}, (): void => {

    for (const store of stores) {
        it(`excludes the instances, waits and releases (${store.title})`, async (): Promise<void> => {
            const {first, second, destroy} = await Instances(store)
            try {
                const name: string = `exclusive:${Date.now()}`
                const lock: MutexLock = (await first.tryAcquire(name))!
                assert.ok(lock)
                assert.strictEqual(await second.tryAcquire(name), undefined)
                //Not reentrant in the instance either
                assert.strictEqual(await first.tryAcquire(name), undefined)
                setTimeout((): unknown => lock.release(), 150)
                const next: MutexLock = await second.acquire(name, {timeout: 3000})
                assert.ok(next.held)
                assert.strictEqual(await first.tryAcquire(name), undefined)
                await next.release()
                assert.ok(await first.tryAcquire(name))
            } finally {
                await destroy()
            }
        })

        it(`runs the functions of the instances one at a time (${store.title})`, async (): Promise<void> => {
            const {first, second, destroy} = await Instances(store)
            try {
                let running: number = 0
                let most: number = 0
                let counter: number = 0
                const name: string = `counter:${Date.now()}`
                const work = (mutex: Mutex): Promise<void> => mutex.synchronized(name, async (): Promise<void> => {
                    most = Math.max(most, ++running)
                    const read: number = counter
                    await sleep(10)
                    counter = read + 1
                    running--
                }, {timeout: 20000})
                await Promise.all(Array.from({length: 6}, (_: unknown, index: number): Promise<void> => work(index % 2 ? first : second)))
                assert.strictEqual(counter, 6)
                assert.strictEqual(most, 1)
            } finally {
                await destroy()
            }
        })

        it(`releases the locks of an instance destroyed (${store.title})`, async (): Promise<void> => {
            const {first, second, destroy} = await Instances(store)
            const other: Container = new Container()
            try {
                const name: string = `destroyed:${Date.now()}`
                const held: Mutex = await other.set(Mutex, {driver: store.driver})
                assert.ok(await held.tryAcquire(name))
                assert.strictEqual(await first.tryAcquire(name), undefined)
                await other.destroy()
                assert.ok(await second.tryAcquire(name))
            } finally {
                await destroy()
            }
        })

        if (store.fenced) {
            it(`gives increasing fencing tokens (${store.title})`, async (): Promise<void> => {
                const {first, second, destroy} = await Instances(store)
                try {
                    const name: string = `fenced:${Date.now()}`
                    const a: MutexLock = (await first.tryAcquire(name))!
                    await a.release()
                    const b: MutexLock = (await second.tryAcquire(name))!
                    assert.ok(b.fence! > a.fence!, `${a.fence} ${b.fence}`)
                } finally {
                    await destroy()
                }
            })
        }

        if (store.expiring) {
            it(`renews the locks held, takes over the ones expired (${store.title})`, async (): Promise<void> => {
                const {first, second, destroy} = await Instances(store, {ttl: 300})
                const raw: MutexDriver = store.raw()
                try {
                    const name: string = `expiring:${Date.now()}`
                    const lock: MutexLock = (await first.tryAcquire(name))!
                    await sleep(1000)
                    assert.ok(lock.held)
                    assert.strictEqual(await second.tryAcquire(name), undefined)
                    await lock.release()
                    //A holder which does not renew it (its process gone): taken over once expired
                    const abandoned = (await raw.acquire(`${name}:abandoned`, 300))!
                    assert.strictEqual(await second.tryAcquire(`${name}:abandoned`), undefined)
                    const started: number = Date.now()
                    const taken: MutexLock = await second.acquire(`${name}:abandoned`, {timeout: 3000})
                    assert.ok(Date.now() - started >= 150)
                    //Its old holder cannot release nor renew it any more
                    assert.strictEqual(await raw.release(`${name}:abandoned`, abandoned), false)
                    assert.strictEqual(await raw.extend(`${name}:abandoned`, abandoned, 1000), false)
                    assert.ok(taken.held)
                } finally {
                    await raw.close()
                    await destroy()
                }
            })
        }

        if (store.kill) {
            it(`loses the locks of a connection closed (${store.title})`, async (): Promise<void> => {
                const {first, second, destroy} = await Instances(store)
                try {
                    const name: string = `connection:${Date.now()}`
                    const lock: MutexLock = (await first.tryAcquire(name))!
                    await store.kill!()
                    for (let attempt = 0; attempt < 50 && lock.held; attempt++) await sleep(50)
                    assert.strictEqual(lock.held, false)
                    assert.ok(lock.signal.reason instanceof MutexLostException)
                    //Released by the database: acquired by the other instance (its connection opened again)
                    assert.ok(await second.acquire(name, {timeout: 3000}))
                    assert.ok(await first.acquire(`${name}:after`, {timeout: 3000}))
                } finally {
                    await destroy()
                }
            })
        }
    }
})
