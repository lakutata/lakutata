# @lakutata/mongo-embedded

[English](README.md) | 中文

用于 Node.js 的嵌入式 MongoDB，`lakutata/orm` 中 `mongo-embedded` 类型的数据库用的就是它。一个数据库的所有集合放在一个目录下的一个文件里（也可以只放在内存中）。SQLite 在一个原生插件里保存它们，运行在单独的线程上，[mingo](https://github.com/kofrasa/mingo) 按 MongoDB 的语义查询和更新它们。客户端的 API 与 TypeORM 所用的 MongoDB 客户端相同，不用 ORM 也可以直接使用。

## 安装

```shell
npm install @lakutata/mongo-embedded
```

- 安装这个包时，会用它的 C 和 C++ 源码（SQLite 和 ICU 的一部分）编译插件（node-gyp）：在较新的机器上大约 15 秒，慢的机器上要几分钟。机器上需要 Python 3 和支持 C++17 的编译器：macOS 上是 Xcode 的 Command Line Tools，Linux 上是 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上是 Visual Studio 的生成工具（"使用 C++ 的桌面开发"）。npm 会提示这个包带有安装脚本。Bun 只运行受信任的包的脚本，需要用 `bun pm trust @lakutata/mongo-embedded` 允许它。
- Node.js `>=20.19.0`、Bun、Electron 主进程或 NW.js。在 Android、iOS 和鸿蒙上，它运行在 `mobile-react` 模板的应用中，模板的 `lakutata mobile stage` 会为每个系统编译插件。用 `@lakutata/builder` 打包的应用会带上插件和它的 ICU 数据。
- 在 `lakutata/orm` 中，`mongo-embedded` 类型的数据源需要这个包，没有安装时会提示安装。

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
- `never`：WAL 写回数据库时同步（每 1000 页一次，以及关闭时）。写入不到 1000 页、又没有关闭的进程，断电时会丢失全部写入。

无论哪种方式，崩溃或断电都不会损坏数据库。在 macOS 和 iOS 上，写回使用 `F_FULLFSYNC`，让写入的顺序在磁盘的缓存中也得到保证；`always` 的每次写入也使用它。一个目录同时只能被一个连接打开：由它的 `LOCK` 文件锁住。

带 `j: true`（或 `fsync: true`）的写关注会在写入完成之前同步 WAL，不管 `sync` 是什么。

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

数据库的行为与以单成员副本集运行的 MongoDB 相同。事务能看到它自己的写入和其余数据的一个快照，提交时一起生效。同一时间只运行一个事务：事务之外的写入和下一个事务都要等它结束。事务打开超过 `transactionLifetimeLimitSeconds`（默认 60）秒会被中止，和 MongoDB 一样。ORM 的 `EntityManager.transaction` 和查询运行器的事务都是这样执行的。

### 变更流

```typescript
import {EmbeddedClient} from '@lakutata/mongo-embedded'

const client = await EmbeddedClient.connect('./data/documents')
const items = client.db().collection('items')
const stream = items.watch([{$match: {operationType: 'insert'}}])
for await (const change of stream) console.log(change.fullDocument)
```

在集合、数据库或客户端上调用 `watch`，得到写入的事件，格式与 MongoDB 相同。目录中的数据库把事件保存在它文件里的 oplog 中，默认 64 MiB（`oplogSize`），变更流可以从它的恢复令牌恢复，数据库重新打开后也可以。内存中的数据库默认不保留 oplog（`oplogSize: 0`）：只有在有变更流打开的时候，写入才会构造事件（事务的写入总会构造，因为变更流可能在提交之前打开），最后 16 MiB 的事件保留在内存中。还没读到的事件已经不在了（从写满的 oplog 中删掉了，或者因为当时没有变更流打开而根本没有构造）时，变更流以 `ChangeStreamHistoryLost` 失败。比保留的事件更早的恢复令牌或 `startAtOperationTime` 也会这样失败。客户端关闭时，或者遍历它的 `for await` 循环结束时，变更流会关闭。在集合上设置 `changeStreamPreAndPostImages`，会保留每次变化前后的文档，供 `fullDocumentBeforeChange` 和 `fullDocument` 使用。

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

全文索引与 MongoDB 8.0 的相同（版本 3）。文本按 Unicode 的标点和空白切分成词；每个词做大小写折叠，去掉所属语言的停用词，其余的用 Snowball 提取词干并去掉变音符号。一个索引使用 15 种语言中的一种，或者 `none`（没有停用词，不提取词干）：由 `default_language` 设置，文档的 `language` 字段可以覆盖它。`$text` 找出包含它任意一个词的文档，只保留包含它每个短语（`"..."`）、并且不包含任何否定词和否定短语（`-word`）的文档，并且按 MongoDB 的方式打分。`{$meta: 'textScore'}` 在投影、排序或管道中给出得分。和 MongoDB 一样，中文、日文等不用空格分词的语言不会被切分成词。不支持版本 1 和 2 的全文索引。

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

地理空间索引和查询与 MongoDB 8.0 的相同。`2dsphere` 索引保存球面上的 GeoJSON 几何体（`Point`、`LineString`、`Polygon`、`MultiPoint`、`MultiLineString`、`MultiPolygon` 和 `GeometryCollection`）和旧式坐标对；`2d` 索引保存平面上的坐标对（`bits`、`min`、`max`）。MongoDB 拒绝索引的几何体，这里也以相同的错误码拒绝。`$geoWithin`（球面上的 `$geometry` 和 `$centerSphere`；平面上的 `$box`、`$polygon` 和 `$center`）、`$geoIntersects`、`$near`、`$nearSphere` 以及 `$geoNear` 阶段找到的文档与 MongoDB 找到的相同，边界上的点也按 MongoDB 的方式算在内，距离也按 MongoDB 的方式计算：从 GeoJSON 点出发以米为单位，在球面上从旧式坐标出发以弧度为单位，在平面上以坐标本身的单位计算。`{$meta: 'geoNearDistance'}` 和 `{$meta: 'geoNearPoint'}` 给出测得的距离和位置。`$geoWithin` 和 `$geoIntersects` 没有索引也能用；`$near` 和 `$geoNear` 和 MongoDB 一样需要索引。球面几何来自 s2js，它是 Google 的 S2 库的 JavaScript 移植（`src/lib/s2`）。

有几处细节与 MongoDB 不同：在 `unique` 的 2dsphere 索引中，线和多边形的覆盖单元有相同的就算冲突，而这些单元与 MongoDB 的不同（点的冲突与 MongoDB 相同）；`2dsphereIndexVersion` 为 1 和 2 时按 3 处理，`coarsestIndexedLevel` 和 `finestIndexedLevel` 接受但不使用；距离相同的文档顺序可能不同；2d 索引上的 `$nearSphere` 与 MongoDB 一样排除越过反子午线的文档，所用的规则接近 MongoDB 在平面上的环，但在环的边缘处不完全相同；`$lookup` 或 `$unionWith` 管道中的 `$geoNear` 会测量另一个集合的每个文档，而不是读取它的索引（结果相同）。在 Bun 和其他版本的 V8（Electron）上，由于数学函数的舍入不同，距离的最后几位可能不同。

## API

- `EmbeddedClient.connect(directory?, options?)`：打开一个数据库（默认 `":memory:"`）。它的选项：`sync`、`syncInterval`、`cacheSize`（页缓存，默认 16 MiB）、`mmapSize`（通过内存映射读取的字节数，默认 0）、`oplogSize`（目录中默认 64 MiB，内存中默认 0）、`writeConcern`（写入的默认写关注）和 `transactionLifetimeLimitSeconds`。客户端打开期间，每 60 秒删除一次被 TTL 索引判定过期的文档；`client.expire()` 立即执行一次。
- `client.startSession()` 和 `client.withSession()` 用于会话和事务；`client.watch()` 得到整个数据库的变更流。
- `client.db()`：数据库，有 `collection(name)`、`createCollection`、`listCollections`、`collections`、`renameCollection`、`dropCollection`、`dropDatabase`、`watch` 和 `command`（`ping`，以及修改集合或其索引选项的 `collMod`）。
- MongoDB 8.0 中 `createCollection` 能创建的集合种类，聚簇集合除外：
  - 带默认 `collation` 的集合，它的查询和索引（包括 `_id`）都使用这个排序规则；
  - 固定大小集合（`capped`、`size`、`max`），按插入顺序读取，支持可追加读取的游标（`tailable`、`awaitData`）；
  - 带校验的集合（用查询操作符或 `$jsonSchema` 写的 `validator`、`validationLevel`、`validationAction`）：违反规则的文档以 `EmbeddedValidationError` 失败，它的 `errInfo` 按 MongoDB 的方式说明原因；
  - 视图（`viewOn`、`pipeline`），通过它们的管道读取；
  - 时间序列集合（`timeseries`、`expireAfterSeconds`），测量值按 MongoDB 未压缩桶的布局保存在 `system.buckets.<name>` 的桶中。查询会读取集合的每个桶。
- `client.db().collection(name)`：集合，有 `find`、`findOne`、`countDocuments`、`estimatedDocumentCount`、`distinct`、`aggregate`（也支持 `$out` 和 `$merge`）、`insertOne`、`insertMany`、`updateOne`、`updateMany`（用操作符或管道）、`replaceOne`、`deleteOne`、`deleteMany`、`findOneAndUpdate`、`findOneAndReplace`、`findOneAndDelete`、`bulkWrite`、`initializeOrderedBulkOp`、`initializeUnorderedBulkOp`、`rename`、`drop`，以及它的索引（`createIndex`、`createIndexes`、`indexes`、`dropIndex`、`dropIndexes`）。
- 游标：`toArray`、`next`、`tryNext`、`hasNext`、`forEach`、`map`、`rewind`、`stream`、`closed` 和 `for await`。`maxTimeMS` 限制读取所用的时间。没有读到末尾的游标空闲 10 分钟后超时，和在 MongoDB 服务器上一样，除非设置了 `noCursorTimeout`。
- 索引：升序、降序和复合索引，唯一、稀疏、部分（`partialFilterExpression`）、哈希、通配符和复合通配符（`$**`、`wildcardProjection`）、隐藏索引，带排序规则的索引，以及 TTL 索引（`expireAfterSeconds`）。查询会使用它们，`_id` 的索引也用于它的范围和排序；查询可以指定使用的索引（`hint`）。全文索引用于 `$text`，`2dsphere` 和 `2d` 索引用于地理空间查询（见上文）。
- 排序规则：查询、排序、写入、聚合和索引上的 `collation` 选项按某个地区的规则比较字符串（`{locale: 'en', strength: 2}` 不区分大小写）。这个包自带 ICU（77.1），所以在每个平台上结果都相同。
- 错误都是 `MongoEmbeddedError`：`EmbeddedDuplicateKeyError`（错误码 11000）、`EmbeddedValidationError`（错误码 121）、`EmbeddedBulkWriteError`（部分写入失败的 `insertMany` 或 `bulkWrite`，带有其余写入的结果）和 `EmbeddedOperationError`（MongoDB 以错误码报告的其他错误，比如 `IndexNotFound`）。
- `EmbeddedWriteConcernError` 在写入完成后报告单个成员无法满足的写关注，比如 `w: 2`。`EmbeddedTransactionError` 报告事务当前状态不允许的调用，比如提交一个从未开始的事务；`EmbeddedExpiredSessionError` 报告使用已经结束的会话。
- `ObjectId`：客户端添加的 id 的类。
