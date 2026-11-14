# Lakutata Embedded MongoDB

The `mongo-embedded` driver provides an application with its own MongoDB, inside its process: TypeORM's MongoDB
entities, repositories and query operators, with documents stored in a file in a directory. There is no server to
install or run, which suits desktop and mobile applications, devices, command-line tools and tests.

It is part of Lakutata, not of TypeORM. The database is the package `@lakutata/mongo-embedded`: SQLite stores the
documents in a native addon, on a dedicated thread, and [mingo](https://github.com/kofrasa/mingo) runs queries and
updates with MongoDB semantics. It behaves like MongoDB 8.0 running as a single-member replica set, with transactions,
change streams, text and geospatial indexes, and collations.

## 1. A first database

```bash
npm install lakutata @lakutata/mongo-embedded
```

The addon is compiled from its C and C++ sources when the package is installed: about 15 seconds on a recent machine, a
few minutes on a slow one. The machine requires Python 3 and a C++17 compiler: the Xcode Command Line Tools on macOS,
`build-essential` (Debian, Ubuntu) or `build-base` (Alpine) on Linux, and the Visual Studio Build Tools ("Desktop
development with C++") on Windows. npm warns that the package has an install script; Bun runs install scripts only for
trusted packages, so allow it with `bun pm trust @lakutata/mongo-embedded`. The package requires Node.js 20.19 or later.

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions, type Database} from 'lakutata/com/database'
import {Column, Entity, Index, ObjectIdColumn} from 'lakutata/decorator/orm'
import type {MongoRepository, ObjectId} from 'lakutata/orm'

@Entity('notes')
class Note {
    @ObjectIdColumn()
    public id: ObjectId

    @Index()
    @Column()
    public folder: string

    @Column()
    public title: string

    @Column()
    public words: number
}

Application
    .run(() => ({
        id: 'notes.app',
        name: 'Notes',
        components: {
            db: buildDatabaseOptions({
                type: 'mongo-embedded',
                //A directory, created when missing
                database: 'data/notes',
                entities: [Note],
                //Creates the indices of the entities
                synchronize: true
            })
        },
        bootstrap: ['db']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const db: Database = await app.getObject<Database>('db')
        const notes: MongoRepository<Note> = db.getMongoRepository(Note)
        await notes.save([
            {folder: 'work', title: 'Plan', words: 120},
            {folder: 'work', title: 'Review', words: 40},
            {folder: 'home', title: 'Shopping', words: 15}
        ])
        //The query operators of MongoDB: ["Plan"]
        console.log((await notes.find({where: {folder: 'work', words: {$gte: 50}}})).map((note: Note): string => note.title))
        //An aggregation: [{_id: 'home', words: 15}, {_id: 'work', words: 160}]
        console.log(await notes.aggregate([{$group: {_id: '$folder', words: {$sum: '$words'}}}, {$sort: {_id: 1}}]).toArray())
        await notes.updateMany({folder: 'home'}, {$set: {folder: 'personal'}})
    })
```

Entities, repositories and queries are the same as for MongoDB in TypeORM (see [MongoDB](DatabaseDrivers.md#mongodb)):
an `@ObjectIdColumn()` typed with the `ObjectId` from `lakutata/orm`, and a `MongoRepository` with MongoDB's methods. An
application can move to a MongoDB server by changing only its options.

## 2. Options

| Option | Default | Meaning |
|---|---|---|
| `database` | `':memory:'` | The database directory, or `':memory:'` for a database that is not saved |
| `sync` | `'interval'` | When writes reach the disk: `'interval'`, `'always'` or `'never'` (section 3) |
| `syncInterval` | `100` | The interval for `sync: 'interval'`, in milliseconds |
| `cacheSize` | 16 MiB | The database's page cache, in bytes |
| `mmapSize` | `0` | How many bytes of the file are read through a memory map instead of the page cache (faster reads) |
| `oplogSize` | 64 MiB, `0` in memory | The maximum size of the oplog that change streams resume from; `0` keeps none (section 5) |
| `writeConcern` | `{w: 1}` | The write concern for writes that do not specify one |
| `transactionLifetimeLimitSeconds` | `60` | The longest a transaction may stay open before it is aborted (section 4) |

The options common to every database (`entities`, `synchronize`, `logging`…) apply too.

## 3. How the documents are stored

- **One file.** Collections and their indices are stored in `data.db` in the directory, a SQLite database in WAL mode
  (with its `data.db-wal`). Each write commits its documents, their index entries and its change events together: a
  crash never leaves a document without its index entries.
- **Durability.** With `sync: 'interval'`, the WAL is synced to disk every 100 milliseconds: a write that has resolved
  survives an application crash, and a computer crash or a power loss loses at most the writes of the last interval.
  `'always'` syncs before each write resolves. `'never'` syncs when the WAL is written back to the database (every 1000
  pages, and when the database closes), so an application that writes fewer than 1000 pages and is not closed can lose
  all its writes on a power loss. None of these modes lets a crash or a power loss corrupt the database. A write concern
  with `j: true` syncs before its write resolves, regardless of `sync`.
- **One process.** A directory is opened by one database at a time: the `LOCK` file locks it. A second database fails to
  open it, with an error that names the process holding it.

## 4. Transactions

`transaction()` runs its function in a database transaction. Its reads see its own writes and a snapshot of the rest;
its writes are committed together when the function returns, and none of them is kept when it throws.

```typescript
import type {Database} from 'lakutata/com/database'
import type {EntityManager} from 'lakutata/orm'

async function moveNotes(db: Database, from: string, to: string): Promise<void> {
    await db.transaction(async (manager: EntityManager): Promise<void> => {
        const notes = manager.getMongoRepository(Note)
        await notes.updateMany({folder: from}, {$set: {folder: to}})
        await manager.save(Note, {folder: to, title: `Moved from ${from}`, words: 0})
    })
}
```

- Only one transaction runs at a time: writes outside it and the next transaction wait until it ends. A write made
  inside the function without its `manager` (through another repository) fails immediately, because it would wait for
  the transaction it is part of.
- A transaction left open longer than `transactionLifetimeLimitSeconds` is aborted, as in MongoDB: its next operations
  and its commit fail.
- Query runner transactions work the same way (`startTransaction()`, `commitTransaction()`, `rollbackTransaction()`).

## 5. Change streams

The database's entity manager is a `MongoEntityManager`: its `watch()` returns changes to an entity's documents, in
MongoDB's change event format.

```typescript
import type {MongoEntityManager} from 'lakutata/orm'

const manager: MongoEntityManager = db.manager as MongoEntityManager
const stream = manager.watch(Note, [{$match: {operationType: 'insert'}}])
for await (const change of stream) {
    if (change.operationType === 'insert') console.log(change.fullDocument.title)
}
```

- A database in a directory keeps events in an oplog in its file. A stream resumes from its resume token (`resumeAfter`,
  `startAfter`), including after the database has been reopened. The oplog is kept in eight parts; once it is full, its
  oldest part is dropped at once, so it holds between six sevenths of `oplogSize` and `oplogSize`.
- A stream fails with `ChangeStreamHistoryLost` when events it has not read are gone, or when it resumes from a token
  older than the oplog.
- With `oplogSize: 0` (the default in memory), writes produce their events only while a stream is open, and the last
  16 MiB of them stay in memory.

## 6. Collections and indices

`synchronize` creates the indices declared on the entities (`@Index()`, `@Unique()`). Other kinds of indices are created
with `createCollectionIndex()`, in a migration or when the application launches: the entity manager's method takes an
entity, and its query runner's method takes a collection name.

```typescript
//A text index of the titles, searched with $text
await manager.createCollectionIndex(Note, {title: 'text'})
//A geospatial index of GeoJSON points, searched with $near or $geoWithin
await manager.mongoQueryRunner.createCollectionIndex('places', {location: '2dsphere'})
```

- **Indices**: ascending, descending and compound, unique, sparse, partial, hashed, wildcard, hidden, with a collation,
  and TTL (`expireAfterSeconds`; expired documents are deleted every 60 seconds). Queries and sorts use them.
- **Text search** (`$text`, `{$meta: 'textScore'}`) works like MongoDB 8.0's, in 15 languages. As in MongoDB, Chinese,
  Japanese and other languages written without spaces are not split into words.
- **Geospatial queries**: `2dsphere` and `2d` indices, `$geoWithin`, `$geoIntersects`, `$near`, `$nearSphere` and the
  `$geoNear` stage, which find the same documents as MongoDB and measure distances as MongoDB does. The few details that
  differ are listed in the `@lakutata/mongo-embedded` README.
- **Collations** compare strings by a language's rules (`{locale: 'en', strength: 2}` ignores case). The package ships
  its own ICU, so results are the same on every platform.
- **Kinds of collections**: capped, validated (`validator`, `$jsonSchema`), views, time series, and collections with a
  default collation. They are created through the database client, the `EmbeddedClient` from `@lakutata/mongo-embedded`,
  which has the MongoDB client API:

```typescript
import type {EmbeddedClient} from '@lakutata/mongo-embedded'

const client: EmbeddedClient = manager.mongoQueryRunner.databaseConnection as unknown as EmbeddedClient
await client.db().createCollection('events', {capped: true, size: 16 * 1024 * 1024})
```

## 7. Large collections

- **Long writes.** `insertMany`, `updateMany`, `deleteMany` and creating an index on existing documents run in batches
  of 1000 documents, letting the application run between batches. As in MongoDB without a transaction, a write that
  fails on a document leaves the documents before it written. As in MongoDB, `insertMany` stops at its first duplicate
  key, or inserts the other documents with `ordered: false`, and then fails with `writeErrors`, `insertedCount` and
  `insertedIds`.
- **Cursors.** A cursor (`createCursor`, `createEntityCursor`) read with `next()`, `hasNext()` or `for await` reads 1000
  documents at a time; `toArray()` reads all of them at once. A cursor that is not read to the end is closed after 10
  idle minutes, as on a MongoDB server.
- **Sorting.** A sort that no index serves holds all the documents it sorts in memory: index the fields that large
  collections are sorted on.
- **Grouping.** A `$group` at the start of a pipeline, after stages that work on one document at a time (`$match`,
  `$project`, `$unwind`…), reads documents one batch at a time: its memory use is that of its groups.

## 8. Platforms

The package runs on macOS, Windows and Linux (glibc and musl), in Node.js, Bun and Electron's main process, and in
applications built from the `mobile-react` template on Android, iOS and HarmonyOS. Applications packaged by
`@lakutata/builder` (a bundle, an executable, an Electron or NW.js application) carry the addon and its ICU data.
Without a JIT (iOS, HarmonyOS), the parts of a query that run in JavaScript are about 3.6 times slower.

## 9. What it does not do

As with a MongoDB server in TypeORM, there are no relations and no query builders; `synchronize` creates the indices,
and migrations are written manually (see [Migrations](Migrations.md)).

It does not have clustered collections, GridFS, Atlas Search, or the text indices of versions 1 and 2 of MongoDB 8.0. It
is a single member: a write concern such as `w: 2` fails with `EmbeddedWriteConcernError` once the write is made.

IDs use the `ObjectId` exported by `lakutata/orm`. Queries also accept the `ObjectId` from the `bson` package, but
`instanceof` distinguishes them: an ID read from the database is not an instance of the `ObjectId` from
`import {ObjectId} from 'bson'`.
