# @lakutata/mongo-embedded

An embedded MongoDB for Node.js, used by the `mongo-embedded` databases of `lakutata/orm`. The collections of a
database live in one file in a directory (or in memory). SQLite stores them in a native addon, on a thread of its own,
and [mingo](https://github.com/kofrasa/mingo) queries and updates them with the semantics of MongoDB. The client has the
API of the client of MongoDB that TypeORM uses, and it can be used without the ORM.

## Installation

```shell
npm install @lakutata/mongo-embedded
```

- The addon is compiled from its C and C++ sources when the package is installed (node-gyp), so the machine needs
  Python 3 and a C++17 compiler: the Command Line Tools of Xcode on macOS, `build-essential` (Debian, Ubuntu) or
  `build-base` (Alpine) on Linux, the Build Tools of Visual Studio ("Desktop development with C++") on Windows. npm
  warns that the package has an install script. Bun runs the scripts of trusted packages only: allow it with
  `bun pm trust @lakutata/mongo-embedded`.
- Node.js `>=20.19.0`, the main process of Electron, or Bun.
- With `lakutata/orm`, a data source of the type `mongo-embedded` needs this package and asks for it when it is not
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

The option `sync` of `EmbeddedClient.connect` (and of the data source):

- `interval` (the default): the WAL is synced every `syncInterval` milliseconds (100 by default). A crash of the
  process loses nothing; a crash of the system or a power loss loses the writes of the last interval at most.
- `always`: each write is synced before it resolves.
- `never`: the WAL is synced when it is written back to the database (every 1000 pages, and at the closing). A
  process that writes fewer pages and is not closed loses all of its writes on a power loss.

None of them lets a crash or a power loss corrupt the database. On macOS and iOS the writes back use `F_FULLFSYNC`, so
that the order of the writes holds through the cache of the drive; `always` uses it for each write too. A directory is opened by one connection at a time: it is
locked by its file `LOCK`.

## API

- `EmbeddedClient.connect(directory?, options?)`: opens a database (`":memory:"` by default). Its options: `sync`,
  `syncInterval`, `cacheSize` (the page cache, 64 MiB by default) and `mmapSize` (the bytes read through a memory map,
  0 by default).
- `client.db().collection(name)`: a collection, with `find`, `findOne`, `countDocuments`, `estimatedDocumentCount`,
  `distinct`, `aggregate`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`,
  `deleteMany` and the definitions of its indexes (`createIndex`, `indexes`, `dropIndex`).
- `EmbeddedDuplicateKeyError` (code 11000) and `EmbeddedBulkWriteError` (an `insertMany` of which documents were not
  inserted), both `MongoEmbeddedError`.
- `ObjectId`: the class of the ids the client adds.
