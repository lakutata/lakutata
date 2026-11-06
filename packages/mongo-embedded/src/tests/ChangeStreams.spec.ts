import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {type EmbeddedOplogEvent, type EmbeddedStore, type EmbeddedStoreTransaction} from '../lib/Store.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-change-streams-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * The events of the oplog, read in batches: their sequences and their payloads (text)
 * @param store
 * @param limit the events of a batch
 */
async function oplog(store: EmbeddedStore, limit: number = 1000): Promise<{ generation: number, sequence: number, text: string }[]> {
    const events: EmbeddedOplogEvent[] = []
    let last: Buffer | undefined
    for (; ;) {
        const read = await store.readEvents(last, limit)
        events.push(...read.events)
        if (read.done || !read.events.length) break
        last = read.events[read.events.length - 1].key
    }
    return events.map((event: EmbeddedOplogEvent): { generation: number, sequence: number, text: string } => ({
        generation: Number(event.key.readBigUInt64BE(0)),
        sequence: Number(event.key.readBigUInt64BE(8)),
        text: event.data.toString()
    }))
}

/**
 * Inserts documents with an event each (its _id as text), in a transaction when one is given
 * @param store
 * @param name
 * @param ids
 * @param transaction
 */
function insert(store: EmbeddedStore, name: string, ids: number[], transaction?: EmbeddedStoreTransaction): Promise<void> {
    return store.exclusive((): Promise<void> => store.write(name, ids.map((id: number): { key: Buffer, next: Record<string, number> } => ({
        key: store.values.idKey(id),
        next: {_id: id}
    })), true, ids.map((id: number): Buffer => Buffer.from(`insert ${id}`)), [Buffer.from(`create ${name}`)]), transaction)
}

describe('The oplog of the change streams', (): void => {

    it('holds the events of the writes in their order, the ones of a transaction once it commits', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const store: EmbeddedStore = client.store
        await insert(store, 'items', [1, 2])
        await insert(store, 'items', [3])
        await store.appendEvents([Buffer.from('appended')])
        const generation: number = store.generation
        assert.deepStrictEqual(await oplog(store, 2), [
            {generation: generation, sequence: 1, text: 'create items'},
            {generation: generation, sequence: 2, text: 'insert 1'},
            {generation: generation, sequence: 3, text: 'insert 2'},
            {generation: generation, sequence: 4, text: 'insert 3'},
            {generation: generation, sequence: 5, text: 'appended'}
        ])
        assert.deepStrictEqual(store.committedKey(), store.eventKey(generation, 5))
        //A transaction: its events read once it commits; an aborted one leaves none, its sequences given again
        let told: number = 0
        const stop: () => void = store.onCommit((): void => {
            told++
        })
        const aborted: EmbeddedStoreTransaction = await store.begin()
        await insert(store, 'items', [10, 11], aborted)
        await insert(store, 'others', [12], aborted)
        assert.strictEqual((await oplog(store)).length, 5)
        await store.abort(aborted)
        assert.strictEqual(told, 0)
        const committed: EmbeddedStoreTransaction = await store.begin()
        await insert(store, 'items', [20], committed)
        assert.deepStrictEqual(store.committedKey(), store.eventKey(generation, 5))
        await store.commit(committed)
        assert.strictEqual(told, 1)
        stop()
        assert.deepStrictEqual((await oplog(store)).slice(5), [{generation: generation, sequence: 6, text: 'insert 20'}])
        assert.deepStrictEqual(store.committedKey(), store.eventKey(generation, 6))
        //A write failing: its events not written
        await assert.rejects(insert(store, 'items', [1]))
        assert.strictEqual((await oplog(store)).length, 6)
        await client.close()
    })

    it('deletes its oldest events beyond its size, in batches', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect(undefined, {oplogSize: 64 * 1024})
        const store: EmbeddedStore = client.store
        const text: string = 'x'.repeat(1000)
        for (let batch: number = 0; batch < 30; batch++)
            await store.appendEvents(Array.from({length: 100}, (_: unknown, n: number): Buffer => Buffer.from(`${batch * 100 + n} ${text}`)))
        const events = await oplog(store)
        //3,000 events of about 1 KB: the oldest ones deleted once the slack (1 MiB) was passed, the newest ones kept
        assert.ok(events.length < 1200, `${events.length} events`)
        assert.ok(events.length >= 60, `${events.length} events`)
        assert.strictEqual(events[events.length - 1].sequence, 3000)
        assert.ok(events.every((event: { sequence: number }, index: number): boolean => index === 0 || event.sequence === events[index - 1].sequence + 1))
        const first: Buffer | null = await store.oldestEvent()
        assert.strictEqual(Number(first!.readBigUInt64BE(8)), events[0].sequence)
        await client.close()
        //No event written: its size 0
        const none: EmbeddedClient = await EmbeddedClient.connect(undefined, {oplogSize: 0})
        await none.store.appendEvents([Buffer.from('lost')])
        assert.deepStrictEqual(await oplog(none.store), [])
        await none.close()
    })

    it('keeps its events through a reopening, a new generation each time; a database in memory begins one of its own', async (): Promise<void> => {
        const at: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(at)
        await insert(client.store, 'items', [1])
        const generation: number = client.store.generation
        const uuid: Buffer = client.store.collection('items')!.uuid
        await client.close()
        client = await EmbeddedClient.connect(at)
        assert.strictEqual(client.store.generation, generation + 1)
        assert.deepStrictEqual(client.store.collection('items')!.uuid, uuid)
        assert.deepStrictEqual(client.store.committedKey(), client.store.eventKey(generation + 1, 0))
        await insert(client.store, 'items', [2])
        assert.deepStrictEqual((await oplog(client.store)).map((event: { generation: number, sequence: number }): number[] => [event.generation - generation, event.sequence]), [[0, 1], [0, 2], [1, 1]])
        const database: Buffer = client.store.databaseId
        await client.close()
        client = await EmbeddedClient.connect(at)
        assert.deepStrictEqual(client.store.databaseId, database)
        await client.close()
        const first: EmbeddedClient = await EmbeddedClient.connect()
        const second: EmbeddedClient = await EmbeddedClient.connect()
        assert.notStrictEqual(first.store.generation, second.store.generation)
        assert.notDeepStrictEqual(first.store.databaseId, second.store.databaseId)
        await first.close()
        await second.close()
    })
})
