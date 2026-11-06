import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {addon} from '../lib/Addon.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-text-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

describe('The text indexes', (): void => {
    it('make the terms of a text as MongoDB 8.0 makes them: words, case folding, stop words, stems, diacritics', (): void => {
        //English (3): the apostrophe kept in a word, the stop words left out (not counted), the stems of Snowball
        assert.deepStrictEqual(addon.textTerms("Don't stop the Running dogs, café-naïve!", 3, 0), {terms: ['stop', 'run', 'dog', 'cafe', 'naiv'], words: 5})
        //Its case kept (1), its diacritics kept (2), no language (0: no stop words, no stems)
        assert.deepStrictEqual(addon.textTerms('Café Running', 3, 1).terms, ['Cafe', 'Run'])
        assert.deepStrictEqual(addon.textTerms('café running', 3, 2).terms, ['café', 'run'])
        assert.deepStrictEqual(addon.textTerms('the running', 0, 0).terms, ['the', 'running'])
        //Turkish (15): its own case folding of I and İ
        assert.deepStrictEqual(addon.textTerms('IŞIK İzmir', 15, 0).terms.map((term: string): string => term[0]), ['ı', 'i'])
        //Chinese: no words but the ones between the delimiters
        assert.deepStrictEqual(addon.textTerms('中文分词 東京', 3, 0).terms, ['中文分词', '東京'])
        assert.strictEqual(addon.textNormalized('Ça Va', 5, 0), 'ca va')
    })

    it('are built from the documents there, follow the writes, and hold their terms after a reopening', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let items = client.db().collection('items')
        await items.insertMany([{_id: 1, a: 'coffee shop'}, {_id: 2, a: 'coffee cake recipe'}, {_id: 3, a: 'tea'}])
        assert.strictEqual(await items.createIndex({a: 'text'}), 'a_text')
        const scores = async (search: string): Promise<unknown> => (await items.find({$text: {$search: search}}, {projection: {s: {$meta: 'textScore'}}, sort: {_id: 1}}).toArray())
            .map((item: Record<string, unknown>): unknown => [item._id, item.s])
        assert.deepStrictEqual(await scores('coffee'), [[1, 0.75], [2, 2 / 3]])
        //Updated: the terms of its new text, the ones of the old one gone
        await items.updateOne({_id: 1}, {$set: {a: 'coffee coffee'}})
        await items.updateOne({_id: 3}, {$set: {a: 'coffee'}})
        await items.deleteOne({_id: 2})
        assert.deepStrictEqual(await scores('coffee'), [[1, 1.5], [3, 1]])
        assert.deepStrictEqual(await scores('tea shop cake'), [])
        await client.close()
        client = await EmbeddedClient.connect(where)
        items = client.db().collection('items')
        assert.deepStrictEqual(await scores('coffee'), [[1, 1.5], [3, 1]])
        //Dropped: a $text fails, a new text index takes the documents again
        await items.dropIndex('a_text')
        await assert.rejects(items.find({$text: {$search: 'coffee'}}).toArray(), (error: unknown): boolean => (error as {code?: number}).code === 27)
        await items.createIndex({a: 'text'}, {default_language: 'none'})
        assert.deepStrictEqual(await scores('coffee'), [[1, 1.5], [3, 1]])
        await client.close()
    })

    it('find the documents of a $text in a transaction, its writes too', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items = client.db().collection('items')
        await items.createIndex({a: 'text'})
        await items.insertOne({_id: 1, a: 'coffee'})
        const session = client.startSession()
        session.startTransaction()
        await items.insertOne({_id: 2, a: 'coffee cake'}, {session: session})
        assert.deepStrictEqual((await items.find({$text: {$search: 'coffee'}}, {session: session, sort: {_id: 1}}).toArray()).map((item: Record<string, unknown>): unknown => item._id), [1, 2])
        assert.deepStrictEqual((await items.find({$text: {$search: 'coffee'}}).toArray()).map((item: Record<string, unknown>): unknown => item._id), [1])
        await session.abortTransaction()
        await session.endSession()
        assert.strictEqual(await items.countDocuments({$text: {$search: 'cake'}}), 0)
        await client.close()
    })
})
