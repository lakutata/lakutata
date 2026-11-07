import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {ExactFloat} from '../lib/s2/r3/ExactFloat.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-geo-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * Numbers from 0 to 1 of a seed, the same each run (mulberry32)
 * @param seed
 */
function random(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6d2b79f5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * The angle between two points of longitudes and latitudes in degrees (radians), measured here
 * @param a
 * @param b
 */
function angle(a: number[], b: number[]): number {
    const vector = ([x, y]: number[]): number[] => {
        const lat: number = y * Math.PI / 180
        const lng: number = x * Math.PI / 180
        return [Math.cos(lng) * Math.cos(lat), Math.sin(lng) * Math.cos(lat), Math.sin(lat)]
    }
    const [p, q] = [vector(a), vector(b)]
    const cross: number[] = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
    return Math.atan2(Math.hypot(...cross), p[0] * q[0] + p[1] * q[1] + p[2] * q[2])
}

describe('The geo indexes and queries', (): void => {
    it('compute exactly the predicates of the sphere (ExactFloat, in place of bigfloat)', (): void => {
        const next: () => number = random(1)
        //Doubles of 2^-8 to 2^20, either sign: exact integers once scaled by 2^60
        const value = (): number => (next() < 0.5 ? -1 : 1) * 2 ** (next() * 28 - 8) * (1 + next())
        for (let round: number = 0; round < 2000; round++) {
            const [x, y] = [value(), value()]
            const [a, b] = [new ExactFloat(x), new ExactFloat(y)]
            const [X, Y] = [BigInt(x * 2 ** 60), BigInt(y * 2 ** 60)]
            assert.strictEqual(a.add(b).cmp(new ExactFloat(X + Y, -60)), 0)
            assert.strictEqual(a.sub(b).cmp(new ExactFloat(X - Y, -60)), 0)
            assert.strictEqual(a.mul(b).cmp(new ExactFloat(X * Y, -120)), 0)
            //Rounded once, as the doubles round
            assert.strictEqual(a.add(b).valueOf(), x + y)
            assert.strictEqual(a.mul(b).valueOf(), x * y)
            assert.strictEqual(a.mul(b).sub(b.mul(a)).isZero(), true)
            assert.strictEqual(a.cmp(b), Math.sign(x - y))
        }
        //The subnormals and the bounds of the doubles
        for (const x of [Number.MIN_VALUE, 3 * Number.MIN_VALUE, 2 ** -1030, -(2 ** -1060), Number.MAX_VALUE, 0, -0])
            assert.strictEqual(new ExactFloat(x).valueOf(), x === 0 ? 0 : x)
        assert.strictEqual(new ExactFloat(Number.MIN_VALUE).add(Number.MIN_VALUE).valueOf(), 2 * Number.MIN_VALUE)
        assert.strictEqual(new ExactFloat(Number.MAX_VALUE).mul(2).mul(0.25).valueOf(), Number.MAX_VALUE / 2)
        assert.strictEqual(new ExactFloat(0.1).mul(3).sub(0.3).getSign(), 1)
        assert.throws((): unknown => new ExactFloat(NaN))
    })

    it('read their $near from the point outwards, as a sort of all the documents by their distances gives them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const next: () => number = random(2)
        const places = client.db().collection('places')
        await places.createIndex({loc: '2dsphere'})
        const points: number[][] = []
        //Spread on the sphere, gathered around the antimeridian, the poles and a city
        for (let i: number = 0; i < 3000; i++) {
            const part: number = i % 4
            const x: number = part === 1 ? 179 + next() * 2 - (next() < 0.5 ? 360 : 0) : part === 3 ? 2.35 + next() * 0.01 : next() * 360 - 180
            const y: number = part === 2 ? (next() < 0.5 ? 89 : -89) + next() - 0.5 : part === 3 ? 48.85 + next() * 0.01 : Math.asin(next() * 2 - 1) * 180 / Math.PI
            points.push([Math.max(-180, Math.min(180, x)), Math.max(-90, Math.min(90, y))])
        }
        await places.insertMany(points.map((loc: number[], _id: number): Record<string, unknown> => ({_id: _id, loc: {type: 'Point', coordinates: loc}})))
        const centers: number[][] = [[0, 0], [180, 0], [-179.5, 0.2], [0, 90], [45, -89.5], [2.355, 48.855], [100, 30]]
        for (const center of centers)
            for (const max of [500, 50000, 2000000, Infinity]) {
                const found = await places.find({loc: {$near: {$geometry: {type: 'Point', coordinates: center}, ...(max === Infinity ? {} : {$maxDistance: max})}}}, {projection: {d: {$meta: 'geoNearDistance'}}}).toArray()
                const distances: number[] = found.map((item: Record<string, any>): number => item.d)
                for (let i: number = 1; i < distances.length; i++) assert.ok(distances[i - 1] <= distances[i], `${center} ${max}: in the order of the distances`)
                //The documents a sort of all gives (but the ones at the bound, within the error of the two measures)
                const expected: number[] = points.map((loc: number[], _id: number): [number, number] => [_id, angle(center, loc) * 6378100])
                    .filter(([, distance]): boolean => distance <= max * (1 - 1e-9)).map(([_id]): number => _id).sort((a: number, b: number): number => a - b)
                const ids: number[] = found.map((item: Record<string, any>): number => item._id)
                const near: Set<number> = new Set(points.map((loc: number[], _id: number): [number, number] => [_id, angle(center, loc) * 6378100])
                    .filter(([, distance]): boolean => max !== Infinity && Math.abs(distance - max) <= max * 1e-9).map(([_id]): number => _id))
                assert.deepStrictEqual(ids.filter((_id: number): boolean => !near.has(_id)).sort((a: number, b: number): number => a - b), expected, `${center} ${max}`)
                found.forEach((item: Record<string, any>): void => assert.ok(Math.abs(item.d - angle(center, points[item._id]) * 6378100) <= 1e-6))
            }
        //A limit reads the closest rings only, the same documents
        const first = await places.find({loc: {$near: {$geometry: {type: 'Point', coordinates: [2.35, 48.85]}}}}).limit(5).toArray()
        const all = await places.find({loc: {$near: {$geometry: {type: 'Point', coordinates: [2.35, 48.85]}}}}).toArray()
        assert.deepStrictEqual(first.map((item: Record<string, any>): unknown => item._id), all.slice(0, 5).map((item: Record<string, any>): unknown => item._id))
        await client.close()
    })

    it('find by their indexes the documents a query of each one finds', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const next: () => number = random(3)
        const db = client.db()
        const documents: Record<string, unknown>[] = []
        const around = (x: number, y: number, size: number): number[][] => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
        for (let i: number = 0; i < 1500; i++) {
            const x: number = next() * 40 - 20
            const y: number = next() * 40 - 20
            const kind: number = i % 5
            documents.push({
                _id: i,
                loc: kind === 0 ? [x, y] : kind === 1 ? {type: 'Point', coordinates: [x, y]} : kind === 2 ? {type: 'LineString', coordinates: [[x, y], [x + next() * 3, y + next() * 3]]}
                    : kind === 3 ? {type: 'Polygon', coordinates: [around(x, y, next() * 2 + 0.01)]} : {type: 'MultiPoint', coordinates: [[x, y], [-x, -y]]}
            })
        }
        const plain = db.collection('plain')
        const indexed = db.collection('indexed')
        await plain.insertMany(documents.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        await indexed.createIndex({loc: '2dsphere'})
        await indexed.insertMany(documents.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        const queries: unknown[] = []
        for (let i: number = 0; i < 40; i++) {
            const x: number = next() * 40 - 20
            const y: number = next() * 40 - 20
            const size: number = next() * 8 + 0.1
            queries.push({$geoWithin: {$geometry: {type: 'Polygon', coordinates: [around(x, y, size)]}}})
            queries.push({$geoIntersects: {$geometry: {type: 'Polygon', coordinates: [around(x, y, size)]}}})
            queries.push({$geoIntersects: {$geometry: {type: 'LineString', coordinates: [[x, y], [x + size, y - size]]}}})
            queries.push({$geoWithin: {$centerSphere: [[x, y], size / 60]}})
            queries.push({$geoWithin: {$box: [[x, y], [x + size, y + size]]}})
        }
        const ids = async (collection: any, filter: unknown): Promise<unknown> => (await collection.find(filter).toArray()).map((item: Record<string, any>): unknown => item._id).sort((a: number, b: number): number => a - b)
        let found: number = 0
        for (const query of queries) {
            const expected: unknown = await ids(plain, {loc: query})
            found += (expected as unknown[]).length
            assert.deepStrictEqual(await ids(indexed, {loc: query}), expected, JSON.stringify(query))
        }
        assert.ok(found > 1000)
        //Compound indexes: a field before the geo field (given by an equality), a field after it (the keys after a cell)
        const before = db.collection('before')
        const behind = db.collection('behind')
        await before.createIndex({k: 1, loc: '2dsphere'})
        await behind.createIndex({loc: '2dsphere', k: 1})
        const keyed: Record<string, unknown>[] = documents.map((document: Record<string, unknown>, position: number): Record<string, unknown> => ({...document, k: position % 3}))
        await before.insertMany(keyed.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        await behind.insertMany(keyed.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        const keyedPlain = db.collection('keyedPlain')
        await keyedPlain.insertMany(keyed.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        for (const query of queries.slice(0, 30)) {
            assert.deepStrictEqual(await ids(before, {k: 1, loc: query}), await ids(keyedPlain, {k: 1, loc: query}), JSON.stringify(query))
            assert.deepStrictEqual(await ids(behind, {loc: query}), await ids(keyedPlain, {loc: query}), JSON.stringify(query))
            assert.deepStrictEqual(await ids(behind, {loc: query, k: {$ne: 2}}), await ids(keyedPlain, {loc: query, k: {$ne: 2}}), JSON.stringify(query))
        }
        const center = {$geometry: {type: 'Point', coordinates: [1, 1]}}
        for (const [collection, filter] of [[before, {k: 2}], [before, {k: {$in: [0, 2]}}], [behind, {}], [behind, {k: {$gt: 0}}]] as [any, Record<string, unknown>][]) {
            const near = (await collection.find({...filter, loc: {$near: center}}, {projection: {d: {$meta: 'geoNearDistance'}}}).toArray()) as Record<string, any>[]
            const expected = (await keyedPlain.find(filter).toArray()).length
            assert.strictEqual(near.length, expected, JSON.stringify(filter))
            for (let i: number = 1; i < near.length; i++) assert.ok(near[i - 1].d <= near[i].d)
        }
        //A 2d index: the shapes of a plane, and the regions of the sphere
        const flat = db.collection('flat')
        await flat.createIndex({loc: '2d'}, {bits: 18})
        const pairs: Record<string, unknown>[] = documents.filter((document: Record<string, unknown>): boolean => Array.isArray(document.loc))
        await flat.insertMany(pairs.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        const pairsPlain = db.collection('pairsPlain')
        await pairsPlain.insertMany(pairs.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        for (const query of [...queries.filter((query: any): boolean => !query.$geoIntersects), {$geoWithin: {$polygon: [[0, 0], [10, 2], [3, 9]]}}, {$geoWithin: {$center: [[1, 1], 6]}}])
            assert.deepStrictEqual(await ids(flat, {loc: query}), await ids(pairsPlain, {loc: query}), JSON.stringify(query))
        await client.close()
    })

    it('keep their keys through the writes, the transactions and a reopening', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let places = client.db().collection('places')
        await places.insertMany([{_id: 'a', loc: [0, 0]}, {_id: 'b', loc: [10, 10]}])
        assert.strictEqual(await places.createIndex({loc: '2dsphere'}), 'loc_2dsphere')
        const within = async (): Promise<unknown> => (await places.find({loc: {$geoWithin: {$centerSphere: [[0, 0], 0.01]}}}).toArray()).map((item: Record<string, any>): unknown => item._id).sort()
        const near = async (): Promise<unknown> => (await places.find({loc: {$near: {$geometry: {type: 'Point', coordinates: [0, 0]}}}}).toArray()).map((item: Record<string, any>): unknown => item._id)
        assert.deepStrictEqual(await within(), ['a'])
        await places.updateOne({_id: 'b'}, {$set: {loc: {type: 'Point', coordinates: [0.1, 0.1]}}})
        assert.deepStrictEqual(await within(), ['a', 'b'])
        assert.deepStrictEqual(await near(), ['a', 'b'])
        //An aborted transaction leaves the keys as they were; a committed one moves them
        const session = client.startSession()
        session.startTransaction()
        await places.updateOne({_id: 'a'}, {$set: {loc: [50, 50]}}, {session: session})
        await places.insertOne({_id: 'c', loc: [0.05, 0]}, {session: session})
        assert.deepStrictEqual((await places.find({loc: {$near: {$geometry: {type: 'Point', coordinates: [0, 0]}}}}, {session: session}).toArray()).map((item: Record<string, any>): unknown => item._id), ['c', 'b', 'a'])
        await session.abortTransaction()
        assert.deepStrictEqual(await near(), ['a', 'b'])
        await session.withTransaction(async (): Promise<void> => {
            await places.deleteOne({_id: 'a'}, {session: session})
        })
        await session.endSession()
        assert.deepStrictEqual(await within(), ['b'])
        await client.close()
        client = await EmbeddedClient.connect(where)
        places = client.db().collection('places')
        assert.deepStrictEqual(await within(), ['b'])
        assert.deepStrictEqual(await near(), ['b'])
        assert.deepStrictEqual((await places.indexes()).map((index: Record<string, any>): unknown => [index.name, index['2dsphereIndexVersion']]), [['_id_', undefined], ['loc_2dsphere', 3]])
        //A geometry it cannot index fails the write, which leaves the documents as they were
        await assert.rejects(places.insertOne({_id: 'bad', loc: {type: 'Point', coordinates: [500, 0]}}), {code: 16755})
        await assert.rejects(places.updateOne({_id: 'b'}, {$set: {loc: 'x'}}), {code: 16755})
        assert.deepStrictEqual(await places.find().toArray(), [{_id: 'b', loc: {type: 'Point', coordinates: [0.1, 0.1]}}])
        await client.close()
    })
})
