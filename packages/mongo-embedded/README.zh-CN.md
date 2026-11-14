# @lakutata/mongo-embedded

[English](README.md) | 中文

用于 Node.js 的嵌入式 MongoDB，`lakutata/orm` 中 `mongo-embedded` 类型的数据库即使用本包。一个数据库的所有集合存放在一个目录下的一个文件中（也可以只存放在内存中）。SQLite 在一个原生插件中保存这些集合，并运行在单独的线程上；[mingo](https://github.com/kofrasa/mingo) 按 MongoDB 的语义执行查询和更新。客户端的 API 与 TypeORM 所用的 MongoDB 客户端相同，不使用 ORM 也可以直接使用。

## 安装

```shell
npm install @lakutata/mongo-embedded
```

- 安装本包时，会使用其 C 和 C++ 源码（SQLite 和 ICU 的一部分）编译插件（node-gyp），在较新的机器上约需 15 秒，在较慢的机器上需要几分钟。机器上需要安装 Python 3 和支持 C++17 的编译器：macOS 上为 Xcode 的 Command Line Tools；Linux 上为 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine）；Windows 上为 Visual Studio 的生成工具（“使用 C++ 的桌面开发”）。npm 会提示本包带有安装脚本；Bun 只运行受信任包的安装脚本，需要通过 `bun pm trust @lakutata/mongo-embedded` 信任本包。
- Node.js `>=20.19.0`、Bun、Electron 主进程或 NW.js。在 Android、iOS 和鸿蒙上，本包运行在 `mobile-react` 模板的应用中，模板的 `lakutata mobile stage` 会为每个系统编译插件。使用 `@lakutata/builder` 打包的应用会包含插件及其 ICU 数据。
- 在 `lakutata/orm` 中，`mongo-embedded` 类型的数据源需要本包，未安装时会提示安装。

## 用法

### 配合 ORM

```typescript
import {DataSource} from 'lakutata/orm'

const dataSource = await new DataSource({type: 'mongo-embedded', database: './data/documents'}).initialize()
await dataSource.mongoManager.insertOne('items', {name: 'a'})
```

### 单独使用

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect('./data/documents')
const items = client.db().collection('items')
await items.insertMany([{name: 'a', n: 1}, {name: 'b', n: 2}])
await items.updateOne({name: 'a'}, {$inc: {n: 10}})
console.log(await items.find({n: {$gte: 2}}).sort({n: -1}).toArray())
await client.close()
```

### 写入什么时候落到磁盘

`EmbeddedClient.connect`（以及数据源）的 `sync` 选项：

- `interval`（默认）：每 `syncInterval` 毫秒（默认 100）同步一次 WAL。进程崩溃不会丢失任何写入；系统崩溃或断电最多丢失最后一个间隔内的写入。
- `always`：每次写入在完成之前同步。
- `never`：WAL 写回数据库时同步（每 1000 页一次，以及关闭时）。写入不足 1000 页且未关闭的进程，断电时会丢失全部写入。

无论采用哪种方式，崩溃或断电都不会损坏数据库。在 macOS 和 iOS 上，写回使用 `F_FULLFSYNC`，使写入的顺序在磁盘缓存中也得到保证；`always` 的每次写入也使用该调用。一个目录同时只能被一个连接打开，由该目录的 `LOCK` 文件锁定。

带 `j: true`（或 `fsync: true`）的写关注会在写入完成之前同步 WAL，与 `sync` 的取值无关。

### 事务

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

数据库的行为与以单成员副本集运行的 MongoDB 相同。事务能看到自身的写入和其余数据的一个快照，这些写入在提交时一起生效。同一时间只运行一个事务，事务之外的写入和下一个事务都需要等待该事务结束。事务打开超过 `transactionLifetimeLimitSeconds`（默认 60）秒会被中止，与 MongoDB 相同。ORM 的 `EntityManager.transaction` 和查询运行器的事务都以这种方式执行。

### 变更流

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect('./data/documents')
const items = client.db().collection('items')
const stream = items.watch([{$match: {operationType: 'insert'}}])
for await (const change of stream) console.log(change.fullDocument)
```

在集合、数据库或客户端上调用 `watch`，即可得到写入的事件，格式与 MongoDB 相同。目录中的数据库将事件保存在其文件内的 oplog 中，默认 64 MiB（`oplogSize`）；变更流可以从其恢复令牌恢复，在数据库重新打开后也可以。内存中的数据库默认不保留 oplog（`oplogSize: 0`），只有存在已打开的变更流时，写入才会构造事件（事务的写入始终会构造事件，因为变更流可能在提交之前打开），最近 16 MiB 的事件保留在内存中。尚未读取的事件已不存在时（已从写满的 oplog 中删除，或因当时没有打开的变更流而根本未构造），变更流以 `ChangeStreamHistoryLost` 失败。早于所保留事件的恢复令牌或 `startAtOperationTime` 也会以同样的方式失败。客户端关闭时，或遍历变更流的 `for await` 循环结束时，变更流会关闭。在集合上设置 `changeStreamPreAndPostImages` 后，会保留每次变化前后的文档，供 `fullDocumentBeforeChange` 和 `fullDocument` 使用。

### 全文检索

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

全文索引与 MongoDB 8.0 相同（版本 3）。文本按 Unicode 的标点和空白切分为词；每个词经过大小写折叠，去掉所属语言的停用词，其余的词用 Snowball 提取词干并去掉变音符号。一个索引使用 15 种语言中的一种，或使用 `none`（没有停用词，不提取词干）。语言由 `default_language` 设置，文档的 `language` 字段可以覆盖该设置。`$text` 找出包含搜索文本中任意一个词的文档，只保留包含其中每个短语（`"..."`）且不包含任何否定词和否定短语（`-word`）的文档，并按 MongoDB 的方式打分。`{$meta: 'textScore'}` 在投影、排序或管道中给出得分。与 MongoDB 相同，中文、日文等不以空格分隔词语的语言不会被切分为词。不支持版本 1 和 2 的全文索引。

### 地理空间查询

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

地理空间索引和查询与 MongoDB 8.0 相同。`2dsphere` 索引保存球面上的 GeoJSON 几何体（`Point`、`LineString`、`Polygon`、`MultiPoint`、`MultiLineString`、`MultiPolygon` 和 `GeometryCollection`）和旧式坐标对；`2d` 索引保存平面上的坐标对（`bits`、`min`、`max`）。MongoDB 拒绝索引的几何体，本包也以相同的错误码拒绝。`$geoWithin`（球面上的 `$geometry` 和 `$centerSphere`；平面上的 `$box`、`$polygon` 和 `$center`）、`$geoIntersects`、`$near`、`$nearSphere` 以及 `$geoNear` 阶段找到的文档与 MongoDB 相同，边界上的点也按 MongoDB 的方式计入，距离也按 MongoDB 的方式计算：从 GeoJSON 点出发时以米为单位，在球面上从旧式坐标出发时以弧度为单位，在平面上以坐标本身的单位计算。`{$meta: 'geoNearDistance'}` 和 `{$meta: 'geoNearPoint'}` 给出测得的距离和位置。`$geoWithin` 和 `$geoIntersects` 没有索引也可以使用；`$near` 和 `$geoNear` 与 MongoDB 一样需要索引。球面几何来自 s2js，即 Google S2 库的 JavaScript 移植（`src/lib/s2`）。

以下细节与 MongoDB 不同：在 `unique` 的 2dsphere 索引中，线和多边形只要有相同的覆盖单元即视为冲突，而这些单元与 MongoDB 的不同（点的冲突与 MongoDB 相同）；`2dsphereIndexVersion` 为 1 和 2 时按 3 处理，`coarsestIndexedLevel` 和 `finestIndexedLevel` 接受但不使用；距离相同的文档顺序可能不同；2d 索引上的 `$nearSphere` 与 MongoDB 一样排除越过反子午线的文档，所用的规则接近 MongoDB 在平面上的环，但在环的边缘处不完全相同；`$lookup` 或 `$unionWith` 管道中的 `$geoNear` 会测量另一个集合的每个文档，而不是读取该集合的索引（结果相同）。在 Bun 和其他版本的 V8（Electron）上，由于数学函数的舍入不同，距离的最后几位可能不同。

## API

- `EmbeddedClient.connect(directory?, options?)`：打开一个数据库（默认 `":memory:"`）。其选项为：`sync`、`syncInterval`、`cacheSize`（页缓存，默认 16 MiB）、`mmapSize`（通过内存映射读取的字节数，默认 0）、`oplogSize`（目录中默认 64 MiB，内存中默认 0）、`writeConcern`（写入的默认写关注）和 `transactionLifetimeLimitSeconds`。客户端打开期间，每 60 秒删除一次被 TTL 索引判定过期的文档；`client.expire()` 立即执行一次。
- `client.startSession()` 和 `client.withSession()` 用于会话和事务；`client.watch()` 得到整个数据库的变更流。
- `client.db()`：数据库，有 `collection(name)`、`createCollection`、`listCollections`、`collections`、`renameCollection`、`dropCollection`、`dropDatabase`、`watch` 和 `command`（`ping`，以及修改集合或其索引选项的 `collMod`）。
- MongoDB 8.0 中 `createCollection` 能创建的集合种类，聚簇集合除外：
  - 带默认 `collation` 的集合，其查询和索引（包括 `_id`）都使用该排序规则；
  - 固定大小集合（`capped`、`size`、`max`），按插入顺序读取，支持可追加读取的游标（`tailable`、`awaitData`）；
  - 带校验的集合（用查询操作符或 `$jsonSchema` 写的 `validator`、`validationLevel`、`validationAction`）：违反规则的文档以 `EmbeddedValidationError` 失败，其 `errInfo` 按 MongoDB 的方式说明原因；
  - 视图（`viewOn`、`pipeline`），通过视图的管道读取；
  - 时间序列集合（`timeseries`、`expireAfterSeconds`），测量值按 MongoDB 未压缩桶的布局保存在 `system.buckets.<name>` 的桶中。查询会读取集合的每个桶。
- `client.db().collection(name)`：集合，有 `find`、`findOne`、`countDocuments`、`estimatedDocumentCount`、`distinct`、`aggregate`（也支持 `$out` 和 `$merge`）、`insertOne`、`insertMany`、`updateOne`、`updateMany`（用操作符或管道）、`replaceOne`、`deleteOne`、`deleteMany`、`findOneAndUpdate`、`findOneAndReplace`、`findOneAndDelete`、`bulkWrite`、`initializeOrderedBulkOp`、`initializeUnorderedBulkOp`、`rename`、`drop`，以及集合的索引（`createIndex`、`createIndexes`、`indexes`、`dropIndex`、`dropIndexes`）。
- 游标：`toArray`、`next`、`tryNext`、`hasNext`、`forEach`、`map`、`rewind`、`stream`、`closed` 和 `for await`。`maxTimeMS` 限制读取所用的时间。未读到末尾的游标空闲 10 分钟后超时（与 MongoDB 服务器相同），除非设置了 `noCursorTimeout`。
- 索引：升序、降序和复合索引，唯一、稀疏、部分（`partialFilterExpression`）、哈希、通配符和复合通配符（`$**`、`wildcardProjection`）、隐藏索引，带排序规则的索引，以及 TTL 索引（`expireAfterSeconds`）。查询会使用这些索引，`_id` 的索引也用于该字段的范围查询和排序；查询可以指定使用的索引（`hint`）。全文索引用于 `$text`，`2dsphere` 和 `2d` 索引用于地理空间查询（见上文）。
- 排序规则：查询、排序、写入、聚合和索引上的 `collation` 选项按某个地区的规则比较字符串（`{locale: 'en', strength: 2}` 不区分大小写）。本包自带 ICU（77.1），因此在各个平台上结果都相同。
- 错误均为 `MongoEmbeddedError`：`EmbeddedDuplicateKeyError`（错误码 11000）、`EmbeddedValidationError`（错误码 121）、`EmbeddedBulkWriteError`（部分写入失败的 `insertMany` 或 `bulkWrite`，带有其余写入的结果）和 `EmbeddedOperationError`（MongoDB 以错误码报告的其他错误，例如 `IndexNotFound`）。
- `EmbeddedWriteConcernError` 在写入完成后报告单个成员无法满足的写关注，例如 `w: 2`。`EmbeddedTransactionError` 报告事务当前状态不允许的调用，例如提交一个从未开始的事务；`EmbeddedExpiredSessionError` 报告对已结束会话的使用。
- `ObjectId`：客户端所添加 ID 的类。
