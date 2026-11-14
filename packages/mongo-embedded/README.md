# @lakutata/mongo-embedded

English | [中文](README.zh-CN.md)

An embedded MongoDB for Node.js, used by the `mongo-embedded` databases of `lakutata/orm`. A database's collections live
in one file in a directory (or in memory). SQLite stores them in a native addon, on a dedicated thread, and
[mingo](https://github.com/kofrasa/mingo) queries and updates them with MongoDB semantics. The client has the API of the
MongoDB client that TypeORM uses, and it can be used without the ORM.

## Installation

```shell
npm install @lakutata/mongo-embedded
```

- The addon is compiled from its C and C++ sources (SQLite and part of ICU) when the package is installed (node-gyp).
  The machine requires Python 3 and a C++17 compiler: the Xcode Command Line Tools on macOS, `build-essential` (Debian,
  Ubuntu) or `build-base` (Alpine) on Linux, and the Visual Studio Build Tools ("Desktop development with C++") on
  Windows. npm warns that the package has an install script. Bun runs install scripts only for trusted packages: allow
  it with `bun pm trust @lakutata/mongo-embedded`.
- Node.js `>=20.19.0`, Bun, Electron's main process, or NW.js. On Android, iOS and HarmonyOS it runs in applications
  built from the `mobile-react` template, whose `lakutata mobile stage` compiles the addon for each system. Applications
  packaged by `@lakutata/builder` carry the addon and its ICU data.
- With `lakutata/orm`, a data source of type `mongo-embedded` requires this package and asks for it when it is not
  installed.

## Usage

### With the ORM

```typescript
import {DataSource} from 'lakutata/orm'

const dataSource = await new DataSource({type: 'mongo-embedded', database: './data/documents'}).initialize()
await dataSource.mongoManager.insertOne('items', {name: 'a'})
```

### On its own

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect('./data/documents')
const items = client.db().collection('items')
await items.insertMany([{name: 'a', n: 1}, {name: 'b', n: 2}])
await items.updateOne({name: 'a'}, {$inc: {n: 10}})
console.log(await items.find({n: {$gte: 2}}).sort({n: -1}).toArray())
await client.close()
```

### When the writes reach the disk

The `sync` option of `EmbeddedClient.connect` (and of the data source):

- `interval` (the default): the WAL is synced every `syncInterval` milliseconds (100 by default). A process crash loses
  nothing; a system crash or a power loss loses at most the writes of the last interval.
- `always`: each write is synced before it resolves.
- `never`: the WAL is synced when it is written back to the database (every 1000 pages, and when the database closes). A
  process that writes fewer than 1000 pages and is not closed loses all its writes on a power loss.

None of these modes lets a crash or a power loss corrupt the database. On macOS and iOS, write-backs use `F_FULLFSYNC`,
so that the write order holds through the drive's cache; `always` also uses it for each write. A directory is opened by
one connection at a time: it is locked by its `LOCK` file.

A write concern with `j: true` (or `fsync: true`) syncs the WAL before the write resolves, regardless of `sync`.

### Transactions

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect('./data/documents')
const accounts = client.db().collection('accounts')
const session = client.startSession()
await session.withTransaction(async () => {
    await accounts.updateOne({_id: 'a'}, {$inc: {balance: -10}}, {session})
    await accounts.updateOne({_id: 'b'}, {$inc: {balance: 10}}, {session})
})
await session.endSession()
await client.close()
```

The database behaves like a single-member MongoDB replica set. A transaction sees its own writes and a snapshot of the
rest, and commits them together. One transaction runs at a time: writes outside it, and the next transaction, wait until
it ends. A transaction is aborted after `transactionLifetimeLimitSeconds` (60 by default), as MongoDB aborts it. The ORM
runs `EntityManager.transaction` and the transactions of its query runners this way.

### Change streams

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect('./data/documents')
const items = client.db().collection('items')
const stream = items.watch([{$match: {operationType: 'insert'}}])
for await (const change of stream) console.log(change.fullDocument)
```

`watch` on a collection, the database or the client returns the events of the writes in MongoDB's format. A database in
a directory keeps them in an oplog in its file, 64 MiB by default (`oplogSize`), and a stream resumes from its resume
token, including after the database is reopened. A database in memory keeps no oplog by default (`oplogSize: 0`): writes
build their events only while a change stream is open (a transaction's writes always build them, because a stream may
open before the commit), and the last 16 MiB of them stay in memory. A stream fails with `ChangeStreamHistoryLost` when
events it has not read are gone: deleted from a full oplog, or never built because no stream was open. A resume token or
a `startAtOperationTime` older than the events kept fails the same way. A stream closes when its client is closed, or
when a `for await` loop over it ends. `changeStreamPreAndPostImages` on a collection keeps the documents before and
after each change for `fullDocumentBeforeChange` and `fullDocument`.

### Text search

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect()
const articles = client.db().collection('articles')
await articles.createIndex({title: 'text', body: 'text'}, {weights: {title: 10}})
await articles.insertOne({title: 'Brewing coffee', body: 'Grind the beans just before brewing.'})
const found = await articles
    .find({$text: {$search: 'coffee -tea'}}, {projection: {score: {$meta: 'textScore'}}})
    .sort({score: {$meta: 'textScore'}})
    .toArray()
console.log(found)
await client.close()
```

Text indexes work like MongoDB 8.0's (version 3). Text is split into words at Unicode punctuation and spaces; each
word's case is folded, its language's stop words are left out, and the rest are stemmed by Snowball and stripped of
their diacritics. An index has one of 15 languages, or `none` (no stop words, no stemming): `default_language` sets it,
and a document's `language` field overrides it. `$text` finds the documents with any of its words, keeps those that
contain each of its phrases (`"..."`) and none of its negated words and phrases (`-word`), and scores them as MongoDB
does. `{$meta: 'textScore'}` provides the score in a projection, a sort or a pipeline. As in MongoDB, Chinese, Japanese
and other languages written without spaces are not split into words. Version 1 and 2 text indexes are not supported.

### Geospatial queries

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect()
const places = client.db().collection('places')
await places.createIndex({location: '2dsphere'})
await places.insertMany([
    {name: 'Louvre', location: {type: 'Point', coordinates: [2.3376, 48.8606]}},
    {name: 'Eiffel Tower', location: {type: 'Point', coordinates: [2.2945, 48.8584]}}
])
const nearby = await places
    .find({location: {$near: {$geometry: {type: 'Point', coordinates: [2.3522, 48.8566]}, $maxDistance: 5000}}})
    .toArray()
console.log(nearby.map((place) => place.name))
await client.close()
```

Geospatial indexes and queries work like MongoDB 8.0's. A `2dsphere` index holds GeoJSON geometries (`Point`,
`LineString`, `Polygon`, `MultiPoint`, `MultiLineString`, `MultiPolygon` and `GeometryCollection`) and legacy coordinate
pairs on the sphere; a `2d` index holds coordinate pairs on a plane (`bits`, `min`, `max`). A geometry MongoDB refuses
to index is refused with the same error code. `$geoWithin` (`$geometry` and `$centerSphere` on the sphere; `$box`,
`$polygon` and `$center` on a plane), `$geoIntersects`, `$near`, `$nearSphere` and the `$geoNear` stage find the
documents that MongoDB finds, including points on a boundary as MongoDB includes them, and measure their distances as
MongoDB does: in meters from a GeoJSON point, in radians from legacy coordinates on the sphere, in the coordinates'
units on a plane. `{$meta: 'geoNearDistance'}` and `{$meta: 'geoNearPoint'}` provide the measured distance and location.
`$geoWithin` and `$geoIntersects` also work without an index; `$near` and `$geoNear` require one, as in MongoDB. The
sphere geometry comes from s2js, a JavaScript port of Google's S2 library (`src/lib/s2`).

A few details differ from MongoDB: in a `unique` 2dsphere index, lines and polygons conflict when they share a cell in
their coverings, and those cells are not MongoDB's (points conflict as they do in MongoDB); `2dsphereIndexVersion` 1 and
2 behave as 3, and `coarsestIndexedLevel` and `finestIndexedLevel` are accepted but not used; documents at the same
distance may come in a different order; a `$nearSphere` on a 2d index leaves out the documents across the antimeridian
as MongoDB does, by a rule close to MongoDB's rings of the plane but not identical at their edges; a `$geoNear` in the
pipeline of a `$lookup` or a `$unionWith` measures every document in the other collection instead of reading its index
(the results are the same). Distances can differ in their last digits on Bun and on other V8 versions (Electron), whose
math functions round differently.

## API

- `EmbeddedClient.connect(directory?, options?)`: opens a database (`":memory:"` by default). Its options: `sync`,
  `syncInterval`, `cacheSize` (the page cache, 16 MiB by default), `mmapSize` (the bytes read through a memory map, 0 by
  default), `oplogSize` (64 MiB in a directory, 0 in memory), `writeConcern` (the default for writes) and
  `transactionLifetimeLimitSeconds`. While it is open, the client deletes documents expired by TTL indexes every 60
  seconds; `client.expire()` does so immediately.
- `client.startSession()` and `client.withSession()` for sessions and transactions; `client.watch()` for a change stream
  of the whole database.
- `client.db()`: the database, with `collection(name)`, `createCollection`, `listCollections`, `collections`,
  `renameCollection`, `dropCollection`, `dropDatabase`, `watch` and `command` (`ping`, and `collMod` to change the
  options of a collection or of one of its indexes).
- The kinds of collection that `createCollection` creates in MongoDB 8.0, except clustered collections:
  - with a default `collation`, used by their queries and their indexes, including the `_id`;
  - capped (`capped`, `size`, `max`), read in insertion order, with tailable cursors (`tailable`,
    `awaitData`);
  - validated (`validator` with query operators or `$jsonSchema`, `validationLevel`, `validationAction`): writing a
    document that breaks the rules fails with `EmbeddedValidationError`, whose `errInfo` explains why as MongoDB
    explains it;
  - views (`viewOn`, `pipeline`), read through their pipelines;
  - time series (`timeseries`, `expireAfterSeconds`), whose measurements are kept in buckets in `system.buckets.<name>`,
    in the layout of MongoDB's uncompressed buckets. A query reads every bucket in the collection.
- `client.db().collection(name)`: a collection, with `find`, `findOne`, `countDocuments`, `estimatedDocumentCount`,
  `distinct`, `aggregate` (`$out` and `$merge` too), `insertOne`, `insertMany`, `updateOne`, `updateMany` (by
  operators or by a pipeline), `replaceOne`, `deleteOne`, `deleteMany`, `findOneAndUpdate`, `findOneAndReplace`,
  `findOneAndDelete`, `bulkWrite`, `initializeOrderedBulkOp`, `initializeUnorderedBulkOp`, `rename`, `drop`, and its
  indexes (`createIndex`, `createIndexes`, `indexes`, `dropIndex`, `dropIndexes`).
- Cursors: `toArray`, `next`, `tryNext`, `hasNext`, `forEach`, `map`, `rewind`, `stream`, `closed` and `for await`.
  `maxTimeMS` limits the time their reads take. A cursor that has not been read to the end times out after 10 minutes
  idle, as it would on a MongoDB server, unless `noCursorTimeout` is set.
- Indexes: ascending, descending and compound, unique, sparse, partial (`partialFilterExpression`), hashed, wildcard and
  compound wildcard (`$**`, `wildcardProjection`), hidden, with a collation, and TTL (`expireAfterSeconds`). Queries use
  them, and the `_id` index for its ranges and sorts; a query can name the index it uses (`hint`). Text indexes serve
  `$text`, and `2dsphere` and `2d` indexes the geospatial queries (see above).
- Collations: the `collation` option on queries, sorts, writes, aggregations and indexes compares strings by a
  locale's rules (`{locale: 'en', strength: 2}` ignores case). The package ships its own ICU (77.1), so results are
  identical on every platform.
- Errors, all of them `MongoEmbeddedError`: `EmbeddedDuplicateKeyError` (code 11000), `EmbeddedValidationError` (code
  121), `EmbeddedBulkWriteError` (an `insertMany` or a `bulkWrite` in which some writes failed, with the other writes'
  result) and `EmbeddedOperationError` (the other errors that MongoDB reports with a code, such as `IndexNotFound`).
- `EmbeddedWriteConcernError` reports a write concern that a single member cannot satisfy, such as `w: 2`, once the
  write is made. `EmbeddedTransactionError` reports a call that a transaction's state does not allow, such as committing
  a transaction that was never started; `EmbeddedExpiredSessionError` reports the use of a session that has ended.
- `ObjectId`: the class of the IDs that the client adds.
