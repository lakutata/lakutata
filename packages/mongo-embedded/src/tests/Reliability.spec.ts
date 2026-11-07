import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {type ChildProcess, spawn} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient, type EmbeddedCollection} from '../exports/MongoEmbedded.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-reliability-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

/**
 * The indexes of the collection written: unique, multikey, compound and descending, hashed, of a collation, partial
 */
const INDEXES: [Record<string, unknown>, Record<string, unknown>][] = [
    [{email: 1}, {name: 'email', unique: true}],
    [{tags: 1}, {name: 'tags'}],
    [{a: 1, b: -1}, {name: 'a_b'}],
    [{b: 'hashed'}, {name: 'b_hashed'}],
    [{name: 1}, {name: 'name_caseless', collation: {locale: 'en', strength: 2}}],
    [{n: 1}, {name: 'n_partial', partialFilterExpression: {kind: 'kept'}}]
]

/**
 * A process writing the documents of a collection with indexes, one operation after the other (an insertion, an
 * update, a deletion, or an insertion of several documents), each one told once it is acknowledged: "<op> <ids>"
 * @param where the directory of the database
 * @param seed
 */
function writer(where: string, seed: number): ChildProcess {
    //A URL: an ES module imports by its URL (a path of Windows is not one)
    const module: string = new URL('../exports/MongoEmbedded.js', import.meta.url).href
    return spawn(process.execPath, ['--input-type=module', '-e', `
        import {EmbeddedClient} from ${JSON.stringify(module)}
        const client = await EmbeddedClient.connect(${JSON.stringify(where)})
        const items = client.db().collection('items')
        for (const [keys, options] of ${JSON.stringify(INDEXES)}) await items.createIndex(keys, options)
        let seed = ${seed}
        const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
        const document = (id) => ({_id: id, email: 'user' + id + '@example.com', tags: ['t' + Math.floor(random() * 5), 't' + Math.floor(random() * 5)], a: Math.floor(random() * 10), b: Math.floor(random() * 10), name: (random() < 0.5 ? 'Name' : 'NAME') + Math.floor(random() * 50), n: Math.floor(random() * 1000), kind: random() < 0.5 ? 'kept' : 'other', text: 'x'.repeat(Math.floor(random() * 3000))})
        let next = ${seed} * 1000000
        const ids = []
        process.stdout.write('ready\\n')
        for (;;) {
            const choice = random()
            if (choice < 0.4 || ids.length < 10) {
                const id = next++
                await items.insertOne(document(id))
                ids.push(id)
                process.stdout.write('insert ' + id + '\\n')
            } else if (choice < 0.55) {
                const batch = Array.from({length: 1 + Math.floor(random() * 50)}, () => next++)
                await items.insertMany(batch.map(document))
                ids.push(...batch)
                process.stdout.write('insert ' + batch.join(' ') + '\\n')
            } else if (choice < 0.85) {
                const id = ids[Math.floor(random() * ids.length)]
                const changed = document(id)
                delete changed._id
                await items.updateOne({_id: id}, {$set: changed})
                process.stdout.write('update ' + id + '\\n')
            } else {
                const [id] = ids.splice(Math.floor(random() * ids.length), 1)
                await items.deleteOne({_id: id})
                process.stdout.write('delete ' + id + '\\n')
            }
        }
    `], {stdio: ['ignore', 'pipe', 'inherit']})
}

/**
 * The ids of documents, sorted
 * @param documents
 */
function ids(documents: Record<string, any>[]): number[] {
    return documents.map((document: Record<string, any>): number => document._id).sort((a: number, b: number): number => a - b)
}

describe('The databases killed while they write', (): void => {

    it('keep every write acknowledged, their indexes holding their documents and no other, the file sound', async (): Promise<void> => {
        const where: string = path.join(ROOT, 'killed')
        //The ids inserted and not deleted, as the acknowledgements tell them
        const present: Set<number> = new Set<number>()
        const random = (seed => (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)(7)
        for (let round: number = 1; round <= 12; round++) {
            const child: ChildProcess = writer(where, round)
            //The last line told, the operation after it maybe written (not acknowledged)
            let acknowledged: number = 0
            let pendingLine: string = ''
            const killAfter: number = 20 + Math.floor(random() * 400)
            await new Promise<void>((resolve: () => void): void => {
                child.stdout!.on('data', (data: Buffer): void => {
                    const lines: string[] = (pendingLine + data.toString()).split('\n')
                    pendingLine = lines.pop()!
                    for (const line of lines) {
                        const [op, ...told] = line.split(' ')
                        if (op === 'insert') for (const id of told) present.add(Number(id))
                        if (op === 'delete') present.delete(Number(told[0]))
                        if (op !== 'ready' && ++acknowledged === killAfter) {
                            child.kill('SIGKILL')
                            resolve()
                        }
                    }
                })
            })
            //Every line it wrote before it was killed read (close: its output ended)
            await new Promise((resolve: (value: unknown) => void): unknown => child.once('close', resolve))
            const client: EmbeddedClient = await EmbeddedClient.connect(where)
            const items: EmbeddedCollection = client.db().collection('items')
            assert.strictEqual(await client.store.integrity(), 'ok', `round ${round}`)
            const documents: Record<string, any>[] = await items.find({}).hint({$natural: 1}).toArray()
            const found: Set<number> = new Set<number>(ids(documents))
            //Every acknowledged insertion there, every acknowledged deletion gone; the one operation not acknowledged when
            //the process was killed may be written or not: an insertion (of several documents: all or none of them), or
            //a deletion
            const missing: number[] = [...present].filter((id: number): boolean => !found.has(id))
            const extra: number[] = [...found].filter((id: number): boolean => !present.has(id))
            const inserted: boolean = missing.length === 0 && extra.length <= 50 && extra.every((id: number): boolean => Math.floor(id / 1000000) === round)
            const deleted: boolean = missing.length === 1 && extra.length === 0
            assert.ok(inserted || deleted, `round ${round}: missing ${missing}, extra ${extra}`)
            for (const id of extra) present.add(id)
            for (const id of missing) present.delete(id)
            assert.strictEqual(await items.estimatedDocumentCount(), documents.length)
            assert.strictEqual(await items.countDocuments({}), documents.length)
            //Each index walked whole: the documents it holds, each once (a partial one: the ones of its filter)
            for (const [, {name, partialFilterExpression}] of INDEXES) {
                const walked: number[] = ids(await items.find(partialFilterExpression ?? {}).hint(name as string).toArray())
                const expected: number[] = ids(documents.filter((document: Record<string, any>): boolean => !partialFilterExpression || document.kind === 'kept'))
                assert.deepStrictEqual(walked, expected, `round ${round}: index ${name}`)
            }
            //The queries by the indexes, those of a scan; the unique emails once
            const step: number = Math.ceil(documents.length / 20)
            const sample: Record<string, any>[] = documents.filter((_: unknown, position: number): boolean => position % step === 0)
            for (const document of sample) {
                const filters: [Record<string, unknown>, Record<string, unknown>?][] = [
                    [{email: document.email}],
                    [{tags: document.tags[0]}],
                    [{a: document.a, b: {$lte: document.b}}],
                    [{b: document.b}],
                    [{name: document.name.toLowerCase()}, {locale: 'en', strength: 2}],
                    [{n: {$gte: document.n}, kind: 'kept'}]
                ]
                for (const [filter, collation] of filters) {
                    const byIndex: number[] = ids(await items.find(filter, {collation: collation}).toArray())
                    const byScan: number[] = ids(await items.find(filter, {collation: collation}).hint({$natural: 1}).toArray())
                    assert.deepStrictEqual(byIndex, byScan, `round ${round}: ${JSON.stringify(filter)}`)
                    assert.strictEqual(await items.countDocuments(filter, {collation: collation}), byScan.length)
                }
            }
            assert.strictEqual(new Set(documents.map((document: Record<string, any>): string => document.email)).size, documents.length)
            await client.close()
        }
        assert.ok(present.size > 100, `${present.size} documents`)
    })
})
