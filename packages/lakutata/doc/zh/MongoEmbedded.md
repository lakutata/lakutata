# Lakutata 嵌入式 MongoDB

`mongo-embedded` 驱动让应用在自己的进程里拥有一个 MongoDB：使用 TypeORM 中 MongoDB 的实体、仓储和查询操作符，文档保存在一个目录的文件中。不需要安装或运行服务器，适合桌面应用、设备、命令行工具和测试。

它是 lakutata 的一部分，不属于 TypeORM。查询由 [mingo](https://github.com/kofrasa/mingo) 执行，它是 MongoDB 查询语言的 JavaScript 实现。

## 1. 第一个数据库

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
                //一个目录，不存在时会自动创建
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
| `sync` | `'interval'` | 写入什么时候刷到磁盘：`'interval'`、`'always'` 或 `'never'`（第 3 节） |
| `syncInterval` | `100` | `sync: 'interval'` 的刷盘间隔，单位毫秒 |
| `cacheSize` | 64 MiB | 读过的文档保留在内存中所用的内存，单位字节；`0` 表示不保留 |
| `compaction` | `{minimumSize: 16 MiB, ratio: 2}` | 什么时候压缩集合的文件；`false` 表示从不压缩（第 3 节） |
| `snapshot` | `{minimumSize: 64 MiB, ratio: 0.25}` | 集合打开期间什么时候保存它的索引；`false` 表示只在关闭时保存（第 3 节） |
| `worker` | `true` | 在 worker 线程中运行数据库（第 4 节） |
| `workerResourceLimits` | 无 | worker 线程的内存限制（第 4 节） |

所有数据库通用的选项（`entities`、`synchronize`、`logging`……）同样适用。

## 3. 文档如何存储

- 每个集合在目录中有自己的文件。一次写入只追加一次文件；文档通过保存在内存中（JavaScript 堆之外）的索引按 `_id` 查找。
- **持久性。** 使用 `sync: 'interval'` 时，写入每 100 毫秒刷到磁盘一次：已经完成的写入在应用崩溃后依然存在，但如果计算机崩溃或断电，可能丢失最后一个间隔内的写入。`'always'` 在每次写入完成前刷盘（同时进行的写入共用一次刷盘）；`'never'` 把刷盘交给操作系统。
- **崩溃。** 被崩溃打断的写入，在数据库再次打开时会被忽略：数据库就是这次写入之前的样子。
- **压缩。** 更新或删除会把文档的旧版本留在文件里。当文件达到 `minimumSize`，并且是有效文档的 `ratio` 倍时，就会压缩：有效文档被复制到一个新文件，读写照常进行。
- **快照。** 索引在数据库关闭时保存到快照；数据库打开期间，自上次快照以来写入了 `minimumSize` 字节并达到文件的 `ratio` 比例时也会保存。打开数据库时先读取快照，再只读取快照之后写入的记录。没有快照时（比如在第一次快照之前崩溃），索引要从整个文件重建：两个索引、1000 万个文档大约需要 60 秒。
- **只能由一个进程打开。** 目录会被打开它的进程锁住。另一个进程打开它会失败，错误信息中会写明占用它的进程。

## 4. worker 线程

默认情况下，数据库运行在一个 worker 线程中：它的查询、写入和文件操作都不会阻塞应用的事件循环。每次调用及其结果在线程之间以 BSON 格式传递，每次调用大约多花 20 微秒。

- `worker: false` 让数据库运行在应用自己的线程中。这样调用更快，查询也可以使用 JavaScript 函数（`$where`、`$function`、`$accumulator`），这些函数无法发送到 worker 线程。
- 除非用 `workerResourceLimits` 设置了自己的限制（`maxOldGenerationSizeMb`、`maxYoungGenerationSizeMb`、`codeRangeSizeMb`、`stackSizeMb`），worker 线程沿用应用的内存限制。超出限制时，被停止的是 worker 线程而不是应用：它的调用会失败，它的目录被解锁。在 Node.js 24 上，256 MB 或更小的限制反而可能让整个进程停止；Bun 会忽略这些限制。

## 5. 大型集合

- **耗时的写入。** `insertMany`、`updateMany`、`deleteMany` 以及在已有文档上创建索引，都按每批 1000 个文档执行，批与批之间让出事件循环。与没有事务的 MongoDB 相同，某个文档写入失败时，它之前的文档仍然保持已写入。
- **`insertMany`。** 与 MongoDB 相同，它在遇到第一个重复键时停止；设置 `ordered: false` 时则继续插入其他文档。之后它会带着 `writeErrors`、`insertedCount` 和 `insertedIds` 失败。
- **游标。** 不带排序的游标（`createCursor`、`createEntityCursor`）用 `next()`、`hasNext()` 或 `for await` 读取时，每次读取 1000 个文档；`toArray()` 则一次读取全部。
- **排序。** 没有索引的排序会把所有参与排序的文档放在内存中：给大型集合中用于排序的字段建索引。带 `limit` 的排序会按索引的顺序读取。
- **分组。** 位于管道开头、只跟在逐个处理文档的阶段（`$match`、`$project`、`$unwind`……）之后的 `$group`，按批读取文档：它占用的内存只是各个分组的内存。
- **索引键**最多大约 1000 字节：写入更大的键会在写入之前失败，错误码与 MongoDB 的 17280 相同。
- 超过 2^53 的整数以 `Long` 保存。在内存中完成的排序里（没有索引，或者没有 `limit`），它们排在其他数字之后，按文本顺序排列。

## 6. 不支持的功能

与 TypeORM 中的 MongoDB 服务器相同：

- 没有关系，没有查询构造器；
- 没有事务：**`transaction()` 会在没有事务的情况下执行它的函数**；
- `synchronize` 只创建索引，迁移需要手写（见 [Migrations](Migrations.md)）。

id 使用的 `ObjectId` 是 `lakutata/orm` 导出的那个。查询也接受 `bson` 包的 `ObjectId`，但 `instanceof` 会区分它们：从数据库读出的 id 不是 `import {ObjectId} from 'bson'` 得到的 `ObjectId` 的实例。
