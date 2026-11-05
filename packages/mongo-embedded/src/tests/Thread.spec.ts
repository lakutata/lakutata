import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {isMainThread, parentPort, Worker, workerData} from 'node:worker_threads'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {addon} from '../lib/Addon.js'
import {type NativeDatabase} from '../lib/Native.js'

const FILE: string = fileURLToPath(import.meta.url)
const CASE: string = 'LAKUTATA_MONGO_EMBEDDED_THREAD_CASE'

declare const Bun: { gc(force: boolean): void } | undefined

//A garbage collection: global.gc with --expose-gc in Node.js, Bun.gc in Bun
function collectGarbage(): void {
    (globalThis as { gc?: () => void }).gc?.()
    if (typeof Bun !== 'undefined') Bun.gc(true)
}

//The cases run in a process of their own (the variable CASE): what they print is checked by the tests
const CASES: Record<string, () => unknown> = {
    //Opened, called once, never closed: the process exits by itself
    async idle(): Promise<void> {
        const database: NativeDatabase = await addon.open('')
        await addon.ping(database, Buffer.from('x'))
        console.log('idle')
    },
    //A client left open with a TTL index: its timer does not hold the process
    async client(): Promise<void> {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        await client.db().collection('items').createIndex({at: 1}, {expireAfterSeconds: 60})
        console.log('client')
    },
    //A call pending, not awaited, nothing else holding the process: it waits for the result
    async pending(): Promise<void> {
        const database: NativeDatabase = await addon.open('')
        addon.ping(database, Buffer.from('late'), 300).then((bytes: Buffer): void => console.log(`pending ${bytes.toString()}`), (error: Error): void => console.log(error.message))
    },
    //Databases left to the garbage collector
    async collected(): Promise<void> {
        for (let index: number = 0; index < 200; index++) await addon.ping(await addon.open(''), Buffer.from('g'))
        for (let index: number = 0; index < 5; index++) {
            collectGarbage()
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 20))
        }
        console.log('collected')
    }
}

//A worker thread calling without pause until it is terminated (workerData 'storm'), or calling once then a slow call
//left pending (workerData 'slow')
async function runWorker(): Promise<void> {
    const database: NativeDatabase = await addon.open('')
    await addon.ping(database, Buffer.from('w'))
    parentPort!.postMessage('ready')
    if (workerData === 'slow') {
        addon.ping(database, Buffer.from('slow'), 500).catch((): void => undefined)
        return
    }
    let answered: number = 0
    const calls = (): void => {
        for (let index: number = 0; index < 64; index++) {
            addon.ping(database, Buffer.alloc(256), index % 8 === 0 ? 1 : 0).then((): void => {
                if (++answered % 64 === 0) calls()
            }, (): void => undefined)
        }
    }
    calls()
}

//A case in a child process of the runtime running the tests
function runCase(name: string): SpawnSyncReturns<string> {
    const args: string[] = typeof Bun === 'undefined' ? ['--expose-gc', FILE] : [FILE]
    return spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 30000, env: {...process.env, [CASE]: name}})
}

if (!isMainThread) {
    await runWorker()
} else if (process.env[CASE]) {
    await CASES[process.env[CASE]]()
} else {
    describe('The thread of a database', (): void => {

        it('lets the process exit when the database is idle, and holds it while a call is pending', (): void => {
            const idle: SpawnSyncReturns<string> = runCase('idle')
            assert.strictEqual(idle.status, 0, idle.stderr)
            assert.strictEqual(idle.stdout.trim(), 'idle')
            const client: SpawnSyncReturns<string> = runCase('client')
            assert.strictEqual(client.status, 0, client.stderr)
            assert.strictEqual(client.stdout.trim(), 'client')
            const pending: SpawnSyncReturns<string> = runCase('pending')
            assert.strictEqual(pending.status, 0, pending.stderr)
            assert.strictEqual(pending.stdout.trim(), 'pending late')
        })

        it('gives the results of the calls in their order, and refuses the calls once it is closed', async (): Promise<void> => {
            const database: NativeDatabase = await addon.open('')
            const results: Buffer[] = await Promise.all(Array.from({length: 100}, (_: unknown, index: number): Promise<Buffer> => addon.ping(database, Buffer.from(`call ${index}`), index % 10 === 0 ? 1 : 0)))
            assert.deepStrictEqual(results.map((bytes: Buffer): string => bytes.toString()), Array.from({length: 100}, (_: unknown, index: number): string => `call ${index}`))
            await addon.close(database)
            await addon.close(database)
            await assert.rejects(addon.ping(database, Buffer.from('x')), /The database of mongo-embedded is closed/)
        })

        it('is stopped when its worker thread exits or is terminated, also while its results are delivered', async (): Promise<void> => {
            const slow: Worker = new Worker(FILE, {workerData: 'slow'})
            await new Promise((resolve: (value: unknown) => void): unknown => slow.once('message', resolve))
            await new Promise((resolve: (value: unknown) => void): unknown => slow.once('exit', resolve))
            for (let round: number = 0; round < 30; round++) {
                const worker: Worker = new Worker(FILE, {workerData: 'storm'})
                await new Promise((resolve: (value: unknown) => void): unknown => worker.once('message', resolve))
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, round % 10))
                await worker.terminate()
            }
            const database: NativeDatabase = await addon.open('')
            assert.strictEqual((await addon.ping(database, Buffer.from('after'))).toString(), 'after')
            await addon.close(database)
        })

        it('is stopped when its database is collected', (): void => {
            const collected: SpawnSyncReturns<string> = runCase('collected')
            assert.strictEqual(collected.status, 0, collected.stderr)
            assert.strictEqual(collected.stdout.trim(), 'collected')
        })
    })
}
