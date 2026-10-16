# Lakutata Embedded MongoDB

The `mongo-embedded` driver gives an application a MongoDB of its own, inside its process: the entities, the
repositories and the query operators of MongoDB in TypeORM, with the documents stored in the files of a directory. There
is no server to install or to run, which suits desktop applications, devices, command line tools and tests.

It is a part of lakutata, not of TypeORM. It runs the queries with [mingo](https://github.com/kofrasa/mingo), a
JavaScript implementation of the query language of MongoDB.

## 1. A first database

```bash
npm install lakutata mingo bson
```

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

The entities, the repositories and the queries are the ones of MongoDB in TypeORM (see
[MongoDB](DatabaseDrivers.md#mongodb)): an `@ObjectIdColumn()` typed with the `ObjectId` of `lakutata/orm`, a
`MongoRepository` with the methods of MongoDB. An application can move to a MongoDB server by changing its options only.

## 2. Options

| Option | Default | Meaning |
|---|---|---|
| `database` | `':memory:'` | The directory of the database, or `':memory:'` for a database that is not saved |
| `sync` | `'interval'` | When the writes are flushed to the disk: `'interval'`, `'always'` or `'never'` (section 3) |
| `syncInterval` | `100` | The interval of the flushes of `sync: 'interval'`, in milliseconds |
| `cacheSize` | 64 MiB | The memory of the documents kept in memory after they are read, in bytes; `0` keeps none |
| `compaction` | `{minimumSize: 16 MiB, ratio: 2}` | When the file of a collection is compacted; `false` never (section 3) |
| `snapshot` | `{minimumSize: 64 MiB, ratio: 0.25}` | When the indices of a collection are saved while it is open; `false` only when it closes (section 3) |
| `worker` | `true` | Run the database in a worker thread (section 4) |
| `workerResourceLimits` | None | The memory limits of the worker thread (section 4) |

The options common to every database (`entities`, `synchronize`, `logging`…) apply too.

## 3. How the documents are stored

- Each collection has its own file in the directory. A write is appended to the file in one write; the documents are
  found by their `_id` through an index held in memory, outside the heap of JavaScript.
- **Durability.** With `sync: 'interval'`, the writes are flushed to the disk every 100 milliseconds: a write that has
  resolved survives a crash of the application, but the last interval of writes can be lost if the computer crashes or
  loses power. `'always'` flushes before each write resolves (the writes made together share one flush); `'never'`
  leaves the flushes to the system.
- **Crashes.** A write cut by a crash is ignored when the database opens again: the database is as it was before that
  write.
- **Compaction.** An update or a delete leaves the old version of the document in the file. Once the file is
  `minimumSize` and `ratio` times larger than its live documents, it is compacted: its live documents are copied to a
  new file, while the reads and the writes go on.
- **Snapshots.** The indices are saved to a snapshot when the database closes, and while it is open once `minimumSize`
  bytes and a `ratio` of the file have been written since the last one. Opening the database reads the snapshot, then
  only the records written after it. Without a snapshot (after a crash before the first one), the indices are built
  again from the whole file: about 60 seconds for 10 million documents with two indices.
- **One process.** A directory is locked by the process that opens it. A second process fails to open it, with an error
  naming the process that holds it.

## 4. The worker thread

By default the database runs in a worker thread: its queries, its writes and its files never block the event loop of
the application. Each call and its results cross between the threads encoded as BSON, which costs about 20 µs a call.

- `worker: false` runs the database in the thread of the application. Its calls are faster, and the queries can then
  use JavaScript functions (`$where`, `$function`, `$accumulator`), which cannot be sent to a worker thread.
- The worker thread has the memory limits of the application unless `workerResourceLimits` sets its own
  (`maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`, `codeRangeSizeMb`, `stackSizeMb`). A worker thread that
  exceeds them is stopped, not the application: its calls fail and its directory is unlocked. A limit of 256 MB or less
  may stop the whole process on Node.js 24 instead; Bun ignores these limits.

## 5. Large collections

- **Long writes.** `insertMany`, `updateMany`, `deleteMany`, and the creation of an index on existing documents run in
  batches of 1000 documents, letting the application run between them. As in MongoDB without a transaction, a write
  that fails on a document leaves the documents before it written.
- **`insertMany`.** As in MongoDB, it stops at its first duplicate key, or inserts the other documents with
  `ordered: false`. It then fails with `writeErrors`, `insertedCount` and `insertedIds`.
- **Cursors.** A cursor without a sort (`createCursor`, `createEntityCursor`) read with `next()`, `hasNext()` or
  `for await` reads 1000 documents at a time; `toArray()` reads all of them at once.
- **Sorting.** A sort without an index holds all the documents it sorts in memory: index the fields that large
  collections are sorted on. A sort with a `limit` reads the order of an index.
- **Grouping.** A `$group` at the start of a pipeline, after stages that work on one document at a time (`$match`,
  `$project`, `$unwind`…), reads the documents a batch at a time: its memory is the one of its groups.
- **Index keys** are limited to about 1000 bytes: a write giving a larger key fails before it is written, with the code
  17280 of MongoDB.
- Integers beyond 2^53 are kept as `Long`. In a sort done in memory (without an index, or without a `limit`), they come
  after the other numbers, in the order of their text.

## 6. What it does not do

As with a MongoDB server in TypeORM:

- no relations, no query builders;
- no transactions: **`transaction()` runs its function without a transaction**;
- `synchronize` creates the indices, and the migrations are written by hand (see [Migrations](Migrations.md)).

The `ObjectId` of the ids is the one exported by `lakutata/orm`. The queries accept the `ObjectId` of the package
`bson` too, but `instanceof` tells them apart: an id read from the database is not an instance of the `ObjectId` of
`import {ObjectId} from 'bson'`.
