# Lakutata 嵌入式 MongoDB

`mongo-embedded` 驱动让应用在自己的进程里拥有一个 MongoDB：使用 TypeORM 中 MongoDB 的实体、仓储和查询操作符，文档保存在一个目录下的文件中。不需要安装或运行服务器，适合桌面和移动应用、设备、命令行工具和测试。

它是 lakutata 的一部分，不属于 TypeORM。数据库本身是 `@lakutata/mongo-embedded` 包：SQLite 在一个原生插件里保存文档，运行在单独的线程上，[mingo](https://github.com/kofrasa/mingo) 按 MongoDB 的语义执行查询和更新。它的行为与以单成员副本集运行的 MongoDB 8.0 相同，支持事务、变更流、全文索引和地理空间索引，以及排序规则（collation）。

## 1. 第一个数据库

```bash
npm install lakutata @lakutata/mongo-embedded
```

安装这个包时，会用它的 C 和 C++ 源码编译插件：在较新的机器上大约 15 秒，慢的机器上要几分钟。机器上需要 Python 3 和支持 C++17 的编译器：macOS 上是 Xcode 的 Command Line Tools，Linux 上是 `build-essential`（Debian、Ubuntu）或 `build-base`（Alpine），Windows 上是 Visual Studio 的生成工具（"使用 C++ 的桌面开发"）。npm 会提示这个包带有安装脚本；Bun 只运行受信任的包的安装脚本，需要用 `bun pm trust @lakutata/mongo-embedded` 允许它。这个包需要 Node.js 20.19 或更高版本。

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
                //一个目录，不存在时会创建
                database: 'data/notes',
                entities: [Note],
                //创建实体的索引
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
        //MongoDB 的查询操作符：["Plan"]
        console.log((await notes.find({where: {folder: 'work', words: {$gte: 50}}})).map((note: Note): string => note.title))
        //聚合：[{_id: 'home', words: 15}, {_id: 'work', words: 160}]
        console.log(await notes.aggregate([{$group: {_id: '$folder', words: {$sum: '$words'}}}, {$sort: {_id: 1}}]).toArray())
        await notes.updateMany({folder: 'home'}, {$set: {folder: 'personal'}})
    })
```

实体、仓储和查询都与 TypeORM 中的 MongoDB 相同（见 [MongoDB](DatabaseDrivers.md#mongodb)）：用 `lakutata/orm` 的 `ObjectId` 作为类型的 `@ObjectIdColumn()`，带有 MongoDB 方法的 `MongoRepository`。只改连接选项，应用就能换成 MongoDB 服务器。

## 2. 选项

| 选项 | 默认值 | 含义 |
|---|---|---|
| `database` | `':memory:'` | 数据库所在的目录，或者 `':memory:'` 表示不保存的数据库 |
| `sync` | `'interval'` | 写入什么时候落到磁盘：`'interval'`、`'always'` 或 `'never'`（第 3 节） |
| `syncInterval` | `100` | `sync: 'interval'` 的间隔，单位毫秒 |
| `cacheSize` | 16 MiB | 数据库的页缓存，单位字节 |
| `mmapSize` | `0` | 通过内存映射而不是页缓存读取的文件字节数（读取更快） |
| `oplogSize` | 64 MiB，内存中为 `0` | 变更流用来恢复的 oplog 最大多大；`0` 表示不保留（第 5 节） |
| `writeConcern` | `{w: 1}` | 没有指定写关注（write concern）的写入所用的写关注 |
| `transactionLifetimeLimitSeconds` | `60` | 事务最多能打开多久，超过就被中止（第 4 节） |

所有数据库通用的选项（`entities`、`synchronize`、`logging`……）同样适用。

## 3. 文档如何存储

- **一个文件。** 集合和它们的索引保存在目录下的 `data.db` 中，这是一个 WAL 模式的 SQLite 数据库（另有它的 `data.db-wal`）。每次写入把它的文档、这些文档的索引条目和它的变更事件一起提交：崩溃不会留下缺少索引条目的文档。
- **持久性。** 使用 `sync: 'interval'` 时，WAL 每 100 毫秒同步到磁盘一次：已经完成的写入在应用崩溃后依然存在，计算机崩溃或断电时最多丢失最后一个间隔内的写入。`'always'` 在每次写入完成之前同步。`'never'` 在 WAL 写回数据库时同步（每 1000 页一次，以及数据库关闭时），所以写入不到 1000 页、又没有关闭的应用，断电时可能丢失全部写入。无论哪种方式，崩溃或断电都不会损坏数据库。带 `j: true` 的写关注会在写入完成之前同步，不管 `sync` 是什么。
- **断电实测。** 在一台写入过程中被强行关机的 Linux 虚拟机上：`'always'` 跑了 4 轮，已经完成的写入一次都没有丢；`'interval'` 跑了 3 轮，每轮丢失的是最后 6 到 68 毫秒内的写入。每一轮之后数据库都完好。
- **一次只能打开一个。** 一个目录同时只能被一个数据库打开，由 `LOCK` 文件锁住。另一个数据库打开它会失败，错误信息中会写明占用它的进程。

## 4. 事务

`transaction()` 在数据库的事务中执行它的函数。函数里的读取能看到它自己的写入，其余的数据是一个快照；函数返回时它的写入一起提交，函数抛出错误时一个都不保留。

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

- 同一时间只运行一个事务：事务之外的写入和下一个事务都要等它结束。在函数里不通过它的 `manager`（而是通过别的仓储）进行的写入会立即失败，因为它要等的正是它自己所在的事务。
- 打开时间超过 `transactionLifetimeLimitSeconds` 的事务会被中止，和 MongoDB 一样：它之后的操作和提交都会失败。
- 查询运行器的事务也是这样（`startTransaction()`、`commitTransaction()`、`rollbackTransaction()`）。

## 5. 变更流

数据库的实体管理器是 `MongoEntityManager`：它的 `watch()` 给出一个实体的文档的变化，格式与 MongoDB 的变更事件相同。

```typescript
import type {MongoEntityManager} from 'lakutata/orm'

const manager: MongoEntityManager = db.manager as MongoEntityManager
const stream = manager.watch(Note, [{$match: {operationType: 'insert'}}])
for await (const change of stream) {
    if (change.operationType === 'insert') console.log(change.fullDocument.title)
}
```

- 目录中的数据库把事件保存在它文件里的 oplog 中。变更流可以从它的恢复令牌（`resumeAfter`、`startAfter`）恢复，数据库重新打开后也可以。oplog 分成八段保存；写满之后，最旧的一段一次删掉，所以它的大小在 `oplogSize` 的七分之六到 `oplogSize` 之间。
- 还没读到的事件已经不在了，或者从比 oplog 更早的令牌恢复时，变更流会以 `ChangeStreamHistoryLost` 失败。
- `oplogSize: 0`（内存中数据库的默认值）时，只有在有变更流打开的时候，写入才会产生事件，最后 16 MiB 的事件保留在内存中。

## 6. 集合和索引

`synchronize` 会创建实体的索引（`@Index()`、`@Unique()`）。其他种类的索引用 `createCollectionIndex()` 创建，放在迁移里或应用启动时：实体管理器的这个方法接受实体，它的查询运行器的这个方法接受集合的名字。

```typescript
//标题的全文索引，用 $text 搜索
await manager.createCollectionIndex(Note, {title: 'text'})
//GeoJSON 点的地理空间索引，用 $near 或 $geoWithin 查询
await manager.mongoQueryRunner.createCollectionIndex('places', {location: '2dsphere'})
```

- **索引**：升序、降序和复合索引，唯一、稀疏、部分、哈希、通配符、隐藏索引，带排序规则的索引，以及 TTL 索引（`expireAfterSeconds`；过期的文档每 60 秒删除一次）。查询和排序都会用到它们。
- **全文检索**（`$text`、`{$meta: 'textScore'}`）与 MongoDB 8.0 相同，支持 15 种语言。和 MongoDB 一样，中文、日文等不用空格分词的语言不会被切分成词。
- **地理空间查询**：`2dsphere` 和 `2d` 索引，`$geoWithin`、`$geoIntersects`、`$near`、`$nearSphere` 以及 `$geoNear` 阶段，找到的文档和 MongoDB 找到的相同，距离也按 MongoDB 的方式计算。少数不同的细节列在 `@lakutata/mongo-embedded` 的 README 中。
- **排序规则**按某种语言的规则比较字符串（`{locale: 'en', strength: 2}` 不区分大小写）。这个包自带 ICU，所以在每个平台上结果都相同。
- **集合的种类**：固定大小集合（capped）、带校验的集合（`validator`、`$jsonSchema`）、视图、时间序列集合，以及带默认排序规则的集合。它们通过数据库的客户端创建，也就是 `@lakutata/mongo-embedded` 的 `EmbeddedClient`，它的 API 与 MongoDB 的客户端相同：

```typescript
import type {EmbeddedClient} from '@lakutata/mongo-embedded'

const client: EmbeddedClient = manager.mongoQueryRunner.databaseConnection as unknown as EmbeddedClient
await client.db().createCollection('events', {capped: true, size: 16 * 1024 * 1024})
```

## 7. 大型集合

- **耗时的写入。** `insertMany`、`updateMany`、`deleteMany` 以及在已有文档上创建索引，都按每批 1000 个文档执行，批与批之间让应用继续运行。与没有事务的 MongoDB 相同，某个文档写入失败时，它之前的文档仍然保持已写入。与 MongoDB 相同，`insertMany` 在遇到第一个重复键时停止，设置 `ordered: false` 时则继续插入其他文档，之后带着 `writeErrors`、`insertedCount` 和 `insertedIds` 失败。
- **游标。** 游标（`createCursor`、`createEntityCursor`）用 `next()`、`hasNext()` 或 `for await` 读取时，每次读取 1000 个文档；`toArray()` 则一次读取全部。没有读到末尾的游标空闲 10 分钟后会被关闭，和 MongoDB 服务器上一样。
- **排序。** 没有索引可用的排序会把所有参与排序的文档放在内存中：给大型集合中用于排序的字段建索引。
- **分组。** 位于管道开头、只跟在逐个处理文档的阶段（`$match`、`$project`、`$unwind`……）之后的 `$group`，按批读取文档：它占用的内存只是各个分组的内存。

## 8. 平台

这个包在 macOS、Windows 和 Linux（glibc 和 musl）上的 Node.js、Bun 和 Electron 主进程中测试过，也在 `mobile-react` 模板的 Android、iOS 和鸿蒙应用中测试过。用 `@lakutata/builder` 打包的应用（打包成单个文件、可执行文件、Electron 或 NW.js 应用）会带上插件和它的 ICU 数据。没有 JIT 的平台上（iOS、鸿蒙），查询中用 JavaScript 执行的部分大约慢 3.6 倍。

## 9. 不支持的功能

与 TypeORM 中的 MongoDB 服务器相同，没有关系，没有查询构造器；`synchronize` 只创建索引，迁移需要手写（见 [Migrations](Migrations.md)）。

MongoDB 8.0 的功能中，它没有聚簇集合、GridFS、Atlas Search，也不支持版本 1 和 2 的全文索引。它只有一个成员：`w: 2` 这样的写关注会在写入完成后以 `EmbeddedWriteConcernError` 失败。

id 使用的 `ObjectId` 是 `lakutata/orm` 导出的那个。查询也接受 `bson` 包的 `ObjectId`，但 `instanceof` 会区分它们：从数据库读出的 id 不是 `import {ObjectId} from 'bson'` 得到的 `ObjectId` 的实例。
