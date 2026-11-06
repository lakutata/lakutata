import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {type EmbeddedStore, type EmbeddedStoreTransaction} from '../lib/Store.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-transactions-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * Inserts documents in a collection, in a transaction when one is given
 * @param store
 * @param name
 * @param documents
 * @param transaction
 */
function insert(store: EmbeddedStore, name: string, documents: Record<string, any>[], transaction?: EmbeddedStoreTransaction): Promise<void> {
    return store.exclusive((): Promise<void> => store.write(name, documents.map((document: Record<string, any>): { key: Buffer, next: Record<string, any> } => ({
        key: store.values.idKey(document._id),
        next: document
    })), true), transaction)
}

/**
 * The _id of the documents of a collection, as a transaction reads them (none: the last commit)
 * @param store
 * @param name
 * @param transaction
 */
async function ids(store: EmbeddedStore, name: string, transaction?: EmbeddedStoreTransaction): Promise<unknown[]> {
    const found: unknown[] = []
    for await (const batch of store.scan(name, [], 1000, transaction)) for (const document of batch) found.push(document._id)
    return found
}

describe('The transactions of the store', (): void => {

    for (const where of ['memory', 'directory']) {
        it(`keep their writes from the reads beside them until they commit, in a database in ${where}`, async (): Promise<void> => {
            const client: EmbeddedClient = await EmbeddedClient.connect(where === 'memory' ? undefined : directory())
            const store: EmbeddedStore = client.store
            await insert(store, 'items', [{_id: 1}, {_id: 2}])
            const transaction: EmbeddedStoreTransaction = await store.begin()
            await insert(store, 'items', [{_id: 3}], transaction)
            await insert(store, 'created', [{_id: 'a'}], transaction)
            //Many writes, more than the page cache holds: the reads beside still see the last commit
            for (let start: number = 10; start < 20010; start += 1000)
                await insert(store, 'items', Array.from({length: 1000}, (_: unknown, n: number): Record<string, unknown> => ({_id: start + n, text: 'x'.repeat(300)})), transaction)
            assert.strictEqual((await ids(store, 'items', transaction)).length, 20003)
            assert.deepStrictEqual(await ids(store, 'items'), [1, 2])
            assert.strictEqual(await store.count('items', transaction), 20003)
            assert.strictEqual(await store.count('items'), 2)
            assert.deepStrictEqual((await store.get('items', [store.values.idKey(3)], transaction))[0], {_id: 3})
            assert.deepStrictEqual(await store.get('items', [store.values.idKey(3)]), [undefined])
            //A collection created in it: only it sees it
            assert.deepStrictEqual(store.names(transaction).sort(), ['created', 'items'])
            assert.deepStrictEqual(store.names(), ['items'])
            assert.deepStrictEqual(await ids(store, 'created'), [])
            assert.deepStrictEqual(await ids(store, 'created', transaction), ['a'])
            //An exclusive write beside it waits for its end
            let written: boolean = false
            const waiting: Promise<void> = insert(store, 'items', [{_id: 100000}]).then((): void => {
                written = true
            })
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
            assert.strictEqual(written, false)
            await store.commit(transaction)
            await waiting
            assert.strictEqual(written, true)
            assert.strictEqual(await store.count('items'), 20004)
            assert.deepStrictEqual(await ids(store, 'created'), ['a'])
            assert.strictEqual(await store.integrity(), 'ok')
            await client.close()
        })

        it(`undo their writes when they abort, the collections, their counts and indexes as they were, in a database in ${where}`, async (): Promise<void> => {
            const at: string | undefined = where === 'memory' ? undefined : directory()
            let client: EmbeddedClient = await EmbeddedClient.connect(at)
            const items = client.db().collection('items')
            await items.createIndex({tags: 1})
            await items.insertMany([{_id: 1, tags: 'a'}, {_id: 2, tags: 'b'}])
            const store: EmbeddedStore = client.store
            const transaction: EmbeddedStoreTransaction = await store.begin()
            //A document of several keys in the index, which marks it multikey; a collection created
            await store.exclusive((): Promise<void> => store.write('items', [{key: store.values.idKey(3), next: {_id: 3, tags: ['c', 'd']}}]), transaction)
            await insert(store, 'created', [{_id: 1}], transaction)
            assert.ok(store.collection('items', transaction)!.multikey.has('tags_1'))
            await store.abort(transaction)
            assert.strictEqual(transaction.ended, true)
            assert.deepStrictEqual(await ids(store, 'items'), [1, 2])
            assert.strictEqual(await store.count('items'), 2)
            assert.deepStrictEqual(store.names(), ['items'])
            assert.strictEqual(store.collection('items')!.multikey.has('tags_1'), false)
            //Its operations after its end fail
            await assert.rejects(insert(store, 'items', [{_id: 9}], transaction), /The transaction ended/)
            //A new transaction, and the writes after it
            const next: EmbeddedStoreTransaction = await store.begin()
            await insert(store, 'items', [{_id: 4, tags: 'e'}], next)
            await store.commit(next)
            await items.insertOne({_id: 5, tags: ['f', 'g']})
            assert.deepStrictEqual((await items.find({tags: 'g'}).toArray()).map((item: Record<string, unknown>): unknown => item._id), [5])
            assert.strictEqual(await items.countDocuments({}), 4)
            await client.close()
            if (!at) return
            //Opened again: the same documents, counts and indexes
            client = await EmbeddedClient.connect(at)
            const reopened = client.db().collection('items')
            assert.strictEqual(await reopened.estimatedDocumentCount(), 4)
            assert.deepStrictEqual((await client.db().collections()).map((collection: { collectionName: string }): string => collection.collectionName), ['items'])
            assert.deepStrictEqual((await reopened.find({tags: {$in: ['a', 'e', 'f']}}).toArray()).map((item: Record<string, unknown>): unknown => item._id), [1, 4, 5])
            assert.strictEqual(await client.store.integrity(), 'ok')
            await client.close()
        })
    }

    it('are aborted by the closing of the database', async (): Promise<void> => {
        const at: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(at)
        const store: EmbeddedStore = client.store
        await insert(store, 'items', [{_id: 1}])
        const transaction: EmbeddedStoreTransaction = await store.begin()
        await insert(store, 'items', [{_id: 2}], transaction)
        await client.close()
        client = await EmbeddedClient.connect(at)
        assert.deepStrictEqual(await ids(client.store, 'items'), [1])
        await client.close()
    })

    it('leave nothing of their writes when the process is killed before they commit', async (): Promise<void> => {
        const at: string = directory()
        const module: string = fileURLToPath(new URL('../exports/MongoEmbedded.js', import.meta.url))
        const child: ChildProcess = spawn(process.execPath, ['--input-type=module', '-e', `
            import {EmbeddedClient} from ${JSON.stringify(module)}
            const client = await EmbeddedClient.connect(${JSON.stringify(at)})
            const store = client.store
            const insert = (documents, transaction) => store.exclusive(() => store.write('items', documents.map((document) => ({key: store.values.idKey(document._id), next: document})), true), transaction)
            await insert([{_id: 0}])
            const transaction = await store.begin()
            for (let start = 1; start < 30001; start += 1000) await insert(Array.from({length: 1000}, (_, n) => ({_id: start + n, text: 'x'.repeat(200)})), transaction)
            process.stdout.write('written\\n')
            setInterval(() => undefined, 1000)
        `], {stdio: ['ignore', 'pipe', 'inherit']})
        await new Promise<void>((resolve: () => void): void => {
            child.stdout!.on('data', (data: Buffer): void => {
                if (data.toString().includes('written')) resolve()
            })
        })
        child.kill('SIGKILL')
        await new Promise((resolve: (value: unknown) => void): unknown => child.once('close', resolve))
        const client: EmbeddedClient = await EmbeddedClient.connect(at)
        assert.strictEqual(await client.store.integrity(), 'ok')
        assert.deepStrictEqual(await ids(client.store, 'items'), [0])
        assert.strictEqual(await client.db().collection('items').estimatedDocumentCount(), 1)
        await client.close()
    })
})
