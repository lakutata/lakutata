import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, type ChildProcess} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {BSON} from 'bson'
import {addon} from '../lib/Addon.js'
import {ChangeKind, Comparison, type NativeChange, type NativeDatabase, NativeError} from '../lib/Native.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-store-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

//A directory of its own for a test (the client creates the directory of a database before it opens it)
function directory(): string {
    const created: string = path.join(ROOT, `${directories++}`)
    mkdirSync(created)
    return created
}

//The key of a number (as EmbeddedValues keys an integer _id: 0x01 then the double, big endian)
function keyOf(value: number): Buffer {
    const key: Buffer = Buffer.alloc(9)
    key[0] = 0x01
    key.writeDoubleBE(value, 1)
    return key
}

function documentOf(value: number, extra: Record<string, unknown> = {}): Buffer {
    return Buffer.from(BSON.serialize({_id: value, n: value, ...extra}))
}

//The documents of the bytes of a get or a scan (BSON one after the other)
function documentsOf(bytes: Buffer): Record<string, any>[] {
    const documents: Record<string, any>[] = []
    for (let at: number = 0; at < bytes.length; at += bytes.readInt32LE(at)) documents.push(BSON.deserialize(bytes.subarray(at, at + bytes.readInt32LE(at))))
    return documents
}

async function get(database: NativeDatabase, name: string, keys: Buffer[]): Promise<(Record<string, any> | null)[]> {
    const {bytes, offsets} = await addon.get(database, name, keys)
    return keys.map((_: Buffer, index: number): Record<string, any> | null => {
        const offset: number = offsets.readInt32LE(index * 4)
        return offset < 0 ? null : BSON.deserialize(bytes.subarray(offset, offset + bytes.readInt32LE(offset)))
    })
}

//Every document of a collection, scanned in batches
async function scanAll(database: NativeDatabase, name: string, limit: number = 1000): Promise<Record<string, any>[]> {
    const documents: Record<string, any>[] = []
    let last: Buffer | undefined
    for (; ;) {
        const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(database, name, {after: last, limit: limit})
        documents.push(...documentsOf(batch.bytes))
        if (batch.done) return documents
        last = batch.last!
    }
}

function inserts(values: number[]): NativeChange[] {
    return values.map((value: number): NativeChange => [ChangeKind.Insert, keyOf(value), documentOf(value)])
}

/**
 * The collections listed by the addon: their names, and the ids of the tables of their indexes
 * @param listed
 */
function collectionsOf(listed: Buffer): { name: string, tables: number[] }[] {
    const collections: { name: string, tables: number[] }[] = []
    for (let at: number = 0; at < listed.length;) {
        const length: number = listed.readUInt32LE(at)
        const name: string = listed.toString('utf8', at + 4, at + 4 + length)
        at += 4 + length + 16
        at += 4 + listed.readUInt32LE(at)
        const count: number = listed.readUInt32LE(at)
        collections.push({name: name, tables: Array.from({length: count}, (_: unknown, index: number): number => Number(listed.readBigInt64LE(at + 4 + index * 8)))})
        at += 4 + count * 8
    }
    return collections
}

describe('The storage of a database', (): void => {

    it('writes, reads and scans the documents of its collections in the order of their keys, and reads them again once reopened', async (): Promise<void> => {
        const where: string = directory()
        let database: NativeDatabase = await addon.open(where)
        await addon.write(database, 'items', inserts([3, 1, 2, -5, 10.5]), true)
        assert.deepStrictEqual((await get(database, 'items', [keyOf(2), keyOf(4), keyOf(-5)])).map((document: Record<string, any> | null): unknown => document?.n ?? null), [2, null, -5])
        assert.strictEqual(await addon.count(database, 'items'), 5)
        //The order of the keys: the bytes of the doubles (big endian), the negative ones after
        assert.deepStrictEqual((await scanAll(database, 'items')).map((document: Record<string, any>): number => document.n), [1, 2, 3, 10.5, -5])
        await addon.close(database)
        database = await addon.open(where)
        assert.strictEqual(await addon.count(database, 'items'), 5)
        assert.deepStrictEqual((await scanAll(database, 'items', 2)).map((document: Record<string, any>): number => document.n), [1, 2, 3, 10.5, -5])
        assert.strictEqual(await addon.integrity(database), 'ok')
        await addon.close(database)
    })

    it('writes a transaction whole or not at all: a duplicate key fails it, telling the change', async (): Promise<void> => {
        const database: NativeDatabase = await addon.open(directory())
        await addon.write(database, 'items', inserts([1, 2]), true)
        await assert.rejects(addon.write(database, 'items', inserts([3, 4, 2, 5])), (error: any): boolean => error.code === NativeError.DuplicateKey && error.index === 2)
        assert.deepStrictEqual((await scanAll(database, 'items')).map((document: Record<string, any>): number => document.n), [1, 2])
        assert.strictEqual(await addon.count(database, 'items'), 2)
        await addon.close(database)
    })

    it('replaces and deletes documents: a replacement of a document missing fails, a deletion of one does nothing', async (): Promise<void> => {
        const database: NativeDatabase = await addon.open('')
        await addon.write(database, 'items', inserts([1, 2, 3]), true)
        //A replacement keeps one entry of the key (an insertion of SQLite compares the value too: deleted, then inserted)
        await addon.write(database, 'items', [[ChangeKind.Replace, keyOf(2), documentOf(2, {replaced: true})], [ChangeKind.Delete, keyOf(3)], [ChangeKind.Delete, keyOf(9)]])
        assert.deepStrictEqual(await scanAll(database, 'items'), [{_id: 1, n: 1}, {_id: 2, n: 2, replaced: true}])
        assert.strictEqual(await addon.count(database, 'items'), 2)
        await assert.rejects(addon.write(database, 'items', [[ChangeKind.Replace, keyOf(7), documentOf(7)]]), (error: any): boolean => error.code === NativeError.Missing && error.index === 0)
        await assert.rejects(addon.write(database, 'other', [[ChangeKind.Replace, keyOf(7), documentOf(7)]]), (error: any): boolean => error.code === NativeError.Missing)
        await addon.write(database, 'other', [[ChangeKind.Delete, keyOf(7)]])
        assert.strictEqual(await addon.count(database, 'other'), 0)
        await addon.close(database)
    })

    it('reads the keys of every size and the documents larger than a page (their cells overflow)', async (): Promise<void> => {
        const database: NativeDatabase = await addon.open(directory())
        //The sizes of the varints of the headers of the records: one byte up to 57 bytes of a blob, two after
        const keys: Buffer[] = [1, 2, 56, 57, 58, 200, 3000].map((size: number): Buffer => Buffer.alloc(size, size % 251))
        const large: Buffer = Buffer.from(BSON.serialize({_id: 'large', text: 'x'.repeat(300000)}))
        await addon.write(database, 'sizes', keys.map((key: Buffer, index: number): NativeChange => [ChangeKind.Insert, key, index === 6 ? large : documentOf(index)]), true)
        const found: (Record<string, any> | null)[] = await get(database, 'sizes', keys)
        assert.deepStrictEqual(found.slice(0, 6).map((document: Record<string, any> | null): unknown => document?.n), [0, 1, 2, 3, 4, 5])
        assert.strictEqual(found[6]!.text.length, 300000)
        const scanned: Record<string, any>[] = await scanAll(database, 'sizes', 1)
        assert.strictEqual(scanned.length, 7)
        assert.strictEqual(scanned.find((document: Record<string, any>): boolean => document._id === 'large')!.text.length, 300000)
        await addon.close(database)
    })

    it('scans in batches of a number of documents, of bytes, and of documents read, leaving out the ones failing its predicates', async (): Promise<void> => {
        const database: NativeDatabase = await addon.open('')
        await addon.write(database, 'items', Array.from({length: 100}, (_: unknown, value: number): NativeChange => [ChangeKind.Insert, keyOf(value), documentOf(value, {text: 'y'.repeat(100), mixed: value % 2 ? 'odd' : value})]), true)
        const first: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(database, 'items', {limit: 10})
        assert.strictEqual(documentsOf(first.bytes).length, 10)
        assert.deepStrictEqual(first.last, keyOf(9))
        assert.strictEqual(first.done, false)
        const bytes: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(database, 'items', {after: first.last!, maxBytes: 500})
        assert.ok(documentsOf(bytes.bytes).length < 10)
        //The predicates: n > 89 leaves 10 documents; the ones of the other batches read none
        const matching: Record<string, any>[] = []
        let last: Buffer | undefined
        let batches: number = 0
        for (let done: boolean = false; !done; batches++) {
            const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(database, 'items', {after: last, maxScanned: 25, predicates: [['n', Comparison.Greater, 89]]})
            matching.push(...documentsOf(batch.bytes))
            last = batch.last ?? undefined
            done = batch.done
        }
        assert.strictEqual(batches, 4)
        assert.deepStrictEqual(matching.map((document: Record<string, any>): number => document.n), [90, 91, 92, 93, 94, 95, 96, 97, 98, 99])
        //A field of another type is left to mingo: the strings of mixed are given, the numbers failing are not
        const mixed: Record<string, any>[] = documentsOf((await addon.scan(database, 'items', {limit: 1000, predicates: [['mixed', Comparison.Equal, 4]]})).bytes)
        assert.deepStrictEqual(mixed.map((document: Record<string, any>): unknown => document.mixed), Array.from({length: 100}, (_: unknown, value: number): unknown => value % 2 ? 'odd' : value).filter((value: unknown): boolean => value === 'odd' || value === 4))
        await addon.close(database)
    })

    it('creates, lists and drops its collections, writing them as the schema changes', async (): Promise<void> => {
        const where: string = directory()
        let database: NativeDatabase = await addon.open(where)
        assert.strictEqual(await addon.createCollection(database, 'a'), true)
        assert.strictEqual(await addon.createCollection(database, 'a'), false)
        await addon.write(database, 'a', inserts([1]))
        //The roots of the tables read again after each change of the schema: the earlier tables are still written
        for (let index: number = 0; index < 30; index++) await addon.write(database, `c${index}`, inserts([index]), true)
        await addon.write(database, 'a', inserts([2]))
        assert.strictEqual(await addon.dropCollection(database, 'c3'), true)
        assert.strictEqual(await addon.dropCollection(database, 'c3'), false)
        await addon.write(database, 'c29', inserts([100]))
        await addon.close(database)
        database = await addon.open(where)
        const listed: Buffer = await addon.collections(database)
        const names: string[] = collectionsOf(listed).map((collection: { name: string }): string => collection.name)
        assert.strictEqual(names.length, 30)
        assert.ok(names.includes('a') && !names.includes('c3') && names.includes('c29'))
        assert.strictEqual(await addon.count(database, 'a'), 2)
        assert.strictEqual(await addon.count(database, 'c29'), 2)
        assert.strictEqual(await addon.count(database, 'c3'), 0)
        await addon.dropDatabase(database)
        assert.strictEqual((await addon.collections(database)).length, 0)
        assert.strictEqual(await addon.integrity(database), 'ok')
        await addon.close(database)
    })

    it('counts the documents again when the connection before it was killed (the counts are written at the closing)', async (): Promise<void> => {
        const where: string = directory()
        const database: NativeDatabase = await addon.open(where)
        await addon.write(database, 'items', inserts([1, 2, 3]), true)
        await addon.close(database)
        //A process writing a document at a time, killed while it writes
        const module: string = fileURLToPath(new URL('../lib/Addon.js', import.meta.url))
        const child: ChildProcess = spawn(process.execPath, ['--input-type=module', '-e', `
            import {addon} from ${JSON.stringify(module)}
            const database = await addon.open(${JSON.stringify(where)})
            for (let n = 10; ; n++) {
                const key = Buffer.alloc(9)
                key[0] = 1
                key.writeDoubleBE(n, 1)
                await addon.write(database, 'items', [[0, key, Buffer.from([5, 0, 0, 0, 0])]])
                if (n === 500) process.stdout.write('written\\n')
            }
        `], {stdio: ['ignore', 'pipe', 'inherit']})
        await new Promise((resolve: (value: unknown) => void): void => {
            child.stdout!.on('data', (data: Buffer): void => {
                if (data.toString().includes('written')) resolve(child.kill('SIGKILL'))
            })
        })
        await new Promise((resolve: (value: unknown) => void): unknown => child.once('exit', resolve))
        const reopened: NativeDatabase = await addon.open(where)
        const scanned: number = (await scanAll(reopened, 'items')).length
        assert.ok(scanned > 3 + 490, `${scanned} documents`)
        assert.strictEqual(await addon.count(reopened, 'items'), scanned)
        assert.strictEqual(await addon.integrity(reopened), 'ok')
        await addon.close(reopened)
        const closed: NativeDatabase = await addon.open(where)
        assert.strictEqual(await addon.count(closed, 'items'), scanned)
        await addon.close(closed)
    })

    it('locks its directory: a second opening fails, also in this process, until it is closed', async (): Promise<void> => {
        const where: string = directory()
        const database: NativeDatabase = await addon.open(where)
        await assert.rejects(addon.open(where), /The database .* of mongo-embedded is opened by this process/)
        await addon.close(database)
        //A file LOCK left by a process which does not run any more: not locked
        writeFileSync(path.join(where, 'LOCK'), '999999\n')
        await addon.close(await addon.open(where))
    })

    it('checkpoints its WAL once it is idle, which the next write restarts from its beginning', async (): Promise<void> => {
        for (const sync of ['interval', 'never', 'always'] as const) {
            const where: string = directory()
            const database: NativeDatabase = await addon.open(where, {sync: sync, syncInterval: 50})
            //300 commits of 10 documents of 3000 bytes: 3000 frames of the WAL at least (a page each)
            for (let commit: number = 0; commit < 300; commit++) {
                await addon.write(database, 'items', Array.from({length: 10}, (_: unknown, index: number): NativeChange => [ChangeKind.Insert, keyOf(commit * 10 + index), documentOf(commit * 10 + index, {text: 'z'.repeat(3000)})]), true)
            }
            //Idle (25 ms without a task): the WAL checkpointed, restarted by the next write from its beginning (overwriting
            //it, the file not growing; it is cut to 64 MiB once restarted, and holds less here)
            const before: number = statSync(path.join(where, 'data.db-wal')).size
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 200))
            await addon.write(database, 'items', inserts([-1]))
            const wal: number = statSync(path.join(where, 'data.db-wal')).size
            assert.ok(before > 10 * 1048576 && wal <= before, `${sync}: the WAL holds ${wal} bytes, ${before} before`)
            assert.strictEqual(await addon.count(database, 'items'), 3001)
            await addon.close(database)
        }
    })
})
