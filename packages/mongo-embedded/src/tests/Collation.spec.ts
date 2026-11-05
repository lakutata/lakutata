import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient, type EmbeddedCollection, EmbeddedDuplicateKeyError, EmbeddedOperationError} from '../exports/MongoEmbedded.js'
import {collatorOf, type EmbeddedCollator} from '../lib/Collation.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-collation-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * A random generator of the tests, seeded
 * @param seed
 */
function seededRandom(seed: number): () => number {
    return (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return seed / 4294967296
    }
}

/**
 * Whether an error is the EmbeddedOperationError of a code
 * @param code
 */
function operationError(code: number): (error: unknown) => boolean {
    return (error: unknown): boolean => error instanceof EmbeddedOperationError && error.code === code
}

/**
 * The names of documents
 * @param documents
 */
function names(documents: Record<string, any>[]): string[] {
    return documents.map((document: Record<string, any>): string => document.name)
}

const CASELESS: Record<string, unknown> = {locale: 'en', strength: 2}

describe('The collations', (): void => {

    it('compare the strings of the queries, the sorts, the counts and distinct by the rules of their locale', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany([{_id: 1, name: 'apple'}, {_id: 2, name: 'Apple'}, {_id: 3, name: 'äpple'}, {_id: 4, name: 'banana'}, {_id: 5, name: 'item10'}, {_id: 6, name: 'item9'}])
        //Without a collation (and with "simple"): the code points
        assert.deepStrictEqual(names(await items.find({name: 'apple'}).toArray()), ['apple'])
        assert.deepStrictEqual(names(await items.find({name: 'apple'}, {collation: {locale: 'simple'}}).toArray()), ['apple'])
        assert.deepStrictEqual(names(await items.find({}).sort({name: 1}).toArray()), ['Apple', 'apple', 'banana', 'item10', 'item9', 'äpple'])
        //Strength 2: the case ignored; strength 1: the accents too
        assert.deepStrictEqual(names(await items.find({name: 'APPLE'}, {collation: CASELESS}).toArray()), ['apple', 'Apple'])
        assert.deepStrictEqual(names(await items.find({name: 'APPLE'}).collation({locale: 'en', strength: 1}).toArray()), ['apple', 'Apple', 'äpple'])
        assert.strictEqual(await items.countDocuments({name: {$in: ['APPLE', 'BANANA']}}, {collation: CASELESS}), 3)
        assert.strictEqual(await items.countDocuments({name: {$gt: 'b'}}, {collation: CASELESS}), 3)
        assert.deepStrictEqual(await items.distinct('name', {name: {$lt: 'b'}}, {collation: {locale: 'en', strength: 1}}), ['apple'])
        //The order of the locale: the accents after the base letters, the digits as numbers when numericOrdering
        assert.deepStrictEqual(names(await items.find({}).sort({name: 1}).collation({locale: 'en'}).toArray()), ['apple', 'Apple', 'äpple', 'banana', 'item10', 'item9'])
        assert.deepStrictEqual(names(await items.find({}).sort({name: 1}).collation({locale: 'en', numericOrdering: true, caseFirst: 'upper'}).toArray()), ['Apple', 'apple', 'äpple', 'banana', 'item9', 'item10'])
        //A string _id: its key is the one of the code points, the filter of a collation matches the others too
        await items.insertMany([{_id: 'key', name: 'k1'}, {_id: 'KEY', name: 'k2'}])
        assert.deepStrictEqual(names(await items.find({_id: 'Key'}, {collation: CASELESS}).toArray()), ['k2', 'k1'])
        await client.close()
    })

    it('check a collation as MongoDB checks it', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertOne({name: 'a'})
        const failures: [unknown, number][] = [
            [{locale: 'xx'}, 2],
            [{locale: ''}, 2],
            [{strength: 2}, 40414],
            [{locale: 'en', strength: 6}, 9],
            [{locale: 'en', strength: '2'}, 14],
            [{locale: 'en', caseFirst: 'up'}, 9],
            [{locale: 'en', alternate: 'none'}, 9],
            [{locale: 'en', maxVariable: 'all'}, 9],
            [{locale: 'en', backwards: 1}, 14],
            [{locale: 'en', colour: 1}, 40415],
            [{locale: 'simple', strength: 2}, 9],
            [{locale: 'en', version: '57.1'}, 2],
            ['en', 14]
        ]
        for (const [collation, code] of failures)
            await assert.rejects(items.find({name: 'a'}, {collation: collation}).toArray(), operationError(code), JSON.stringify(collation))
        //The attributes a locale takes when they are not given
        assert.strictEqual(collatorOf({locale: 'fr_CA'})!.collation.backwards, true)
        assert.deepStrictEqual(collatorOf({locale: 'de@collation=phonebook', strength: 2})!.collation, {locale: 'de@collation=phonebook', caseLevel: false, caseFirst: 'off', strength: 2, numericOrdering: false, alternate: 'non-ignorable', maxVariable: 'punct', normalization: false, backwards: false, version: '77.1'})
        //The same attributes in another order: the same collator
        assert.strictEqual(collatorOf({locale: 'en', strength: 2, caseLevel: true}), collatorOf({locale: 'en', caseLevel: true, strength: 2}))
        await client.close()
    })

    it('keep the strings of an index with a collation by it, its unique keys too, its queries the ones of a scan', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let items: EmbeddedCollection = client.db().collection('items')
        //Unique by the collation: "a" and "A" are one key
        const emails: EmbeddedCollection = client.db().collection('emails')
        await emails.createIndex({email: 1}, {unique: true, collation: CASELESS})
        await emails.insertOne({email: 'ada@example.com'})
        await assert.rejects(emails.insertOne({email: 'ADA@example.com'}), (error: unknown): boolean => error instanceof EmbeddedDuplicateKeyError && error.code === 11000)
        //The same fields in another collation: another index; the same name in another collation: a conflict
        await emails.createIndex({email: 1}, {name: 'plain'})
        await assert.rejects(emails.createIndex({email: 1}, {name: 'plain', collation: {locale: 'fr'}}), operationError(85))
        await assert.rejects(emails.createIndex({_id: 1}, {collation: {locale: 'fr'}}), operationError(2))
        const listed: Record<string, any> = (await emails.indexes()).find((index: Record<string, any>): boolean => index.name === 'email_1')!
        assert.deepStrictEqual(listed.collation, {locale: 'en', caseLevel: false, caseFirst: 'off', strength: 2, numericOrdering: false, alternate: 'non-ignorable', maxVariable: 'punct', normalization: false, backwards: false, version: '77.1'})
        //Random strings of cases and accents: the queries by the index, those of a scan
        const random: () => number = seededRandom(23)
        const letters: string[] = ['a', 'A', 'á', 'b', 'B', 'c', 'Ç', 'é', 'E', 'z', ' ', '-', '1', '2', '10']
        const text = (): string => Array.from({length: 1 + Math.floor(random() * 4)}, (): string => letters[Math.floor(random() * letters.length)]).join('')
        await items.insertMany(Array.from({length: 600}, (_: unknown, n: number): Record<string, unknown> => ({_id: n, s: random() < 0.1 ? n : text(), t: text()})))
        const collations: Record<string, unknown>[] = [CASELESS, {locale: 'fr', strength: 1}, {locale: 'en', numericOrdering: true, alternate: 'shifted'}]
        const probes: string[] = Array.from({length: 12}, text)
        const scans: unknown[][] = []
        for (const collation of collations)
            for (const probe of probes)
                for (const filter of [{s: probe}, {s: {$gte: probe}}, {s: {$lt: probe, $gt: 'a'}}, {s: {$in: [probe, 'b']}}, {s: {$lt: 5}}])
                    scans.push((await items.find(filter, {collation: collation}).hint({$natural: 1}).toArray()).map((item: Record<string, any>): number => item._id).sort((a: number, b: number): number => a - b))
        const check = async (): Promise<void> => {
            let position: number = 0
            for (const collation of collations)
                for (const probe of probes)
                    for (const filter of [{s: probe}, {s: {$gte: probe}}, {s: {$lt: probe, $gt: 'a'}}, {s: {$in: [probe, 'b']}}, {s: {$lt: 5}}]) {
                        const expected: unknown[] = scans[position++]
                        const found: number[] = (await items.find(filter, {collation: collation}).toArray()).map((item: Record<string, any>): number => item._id).sort((a: number, b: number): number => a - b)
                        assert.deepStrictEqual(found, expected, `${JSON.stringify(collation)} ${JSON.stringify(filter)}`)
                        assert.strictEqual(await items.countDocuments(filter, {collation: collation}), expected.length)
                    }
            //Sorted by the index (a limit) or in memory: the order of the collator
            for (const collation of collations) {
                const collator: EmbeddedCollator = collatorOf(collation)!
                const all: Record<string, any>[] = await items.find({}).toArray()
                const strings: string[] = all.filter((item: Record<string, any>): boolean => typeof item.s === 'string').map((item: Record<string, any>): string => item.s).sort((a: string, b: string): number => collator.compare(a, b))
                //The strings the collator tells equal may come in another order
                const sorted: Record<string, any>[] = await items.find({s: {$type: 'string'}}, {collation: collation}).sort({s: 1}).limit(50).toArray()
                assert.strictEqual(sorted.length, 50)
                sorted.forEach((item: Record<string, any>, position: number): void => assert.strictEqual(collator.compare(item.s, strings[position]), 0, `${JSON.stringify(collation)} ${position}`))
            }
        }
        await check()
        for (const collation of collations) await items.createIndex({s: 1}, {name: `s_${collations.indexOf(collation)}`, collation: collation})
        await items.createIndex({s: 'hashed'}, {collation: CASELESS})
        await check()
        //The strings of a query of the collation of an index read by it; the ones of another collation (or none) by a scan
        const scan = client.store.scan.bind(client.store)
        let scanned: number = 0
        ;(client.store as any).scan = (...rest: any[]): unknown => {
            scanned++
            return (scan as any)(...rest)
        }
        await items.find({s: probes[0]}, {collation: CASELESS}).toArray()
        await items.find({s: {$gte: probes[0]}}, {collation: collations[1]}).toArray()
        assert.strictEqual(await items.countDocuments({s: {$in: probes}}, {collation: collations[2]}), await items.countDocuments({s: {$in: probes}}, {collation: collations[2], hint: {$natural: 1}}))
        assert.strictEqual(scanned, 1)
        await items.find({s: probes[0]}).toArray()
        await items.find({s: probes[0]}, {collation: {locale: 'de'}}).toArray()
        assert.strictEqual(scanned, 3)
        ;(client.store as any).scan = scan
        //Opened again: the collations of the indexes read from the catalog
        await client.close()
        client = await EmbeddedClient.connect(where)
        items = client.db().collection('items')
        await check()
        await client.close()
    })

    it('compare the strings of the aggregations and of the writes', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany([{_id: 1, city: 'Paris'}, {_id: 2, city: 'paris'}, {_id: 3, city: 'PARIS'}, {_id: 4, city: 'Lyon'}])
        const groups: Record<string, any>[] = await items.aggregate([{$match: {city: {$ne: 'lyon'}}}, {$group: {_id: '$city', count: {$sum: 1}}}, {$sort: {_id: 1}}], {collation: CASELESS}).toArray()
        assert.deepStrictEqual(groups.map((group: Record<string, any>): number => group.count), [3])
        assert.deepStrictEqual((await items.aggregate([{$group: {_id: '$city'}}], {collation: CASELESS}).toArray()).length, 2)
        assert.deepStrictEqual((await items.aggregate([{$group: {_id: '$city'}}]).toArray()).length, 4)
        assert.strictEqual((await items.updateMany({city: 'PARIS'}, {$set: {france: true}}, {collation: CASELESS})).modifiedCount, 3)
        assert.strictEqual((await items.deleteOne({city: 'LYON'}, {collation: CASELESS})).deletedCount, 1)
        assert.deepStrictEqual(await items.findOneAndUpdate({city: 'PARIS'}, {$set: {first: true}}, {collation: CASELESS, sort: {_id: -1}, returnDocument: 'after', projection: {_id: 1}}), {_id: 3})
        const result = await items.bulkWrite([{deleteMany: {filter: {city: 'PARIS'}, collation: CASELESS}}])
        assert.strictEqual(result.deletedCount, 3)
        await client.close()
    })
})
