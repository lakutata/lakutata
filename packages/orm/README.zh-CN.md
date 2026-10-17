# @lakutata/orm

[English](README.md) | 中文

lakutata 框架的 ORM，基于 [TypeORM](https://typeorm.io) 1 构建。它提供 `Database` 组件（整个应用共享的连接）、`Database` 提供者（有自己的连接）、实体的装饰器、TypeORM 的 API（仓储、查询操作符、查询构造器、迁移），以及应用的迁移命令（`MIGRATION_GENERATE`、`MIGRATION_RUN`、`MIGRATION_REVERT`、`MIGRATION_SHOW`）。

`lakutata` 包重新导出了它：`lakutata/com/database`（组件）、`lakutata/provider/database`（提供者）、`lakutata/decorator/orm`（实体的装饰器）和 `lakutata/orm`（TypeORM 的 API）。

## 安装

```shell
npm install lakutata pg        # 框架，以及 PostgreSQL 驱动
npm install @lakutata/orm      # 或者只装 ORM，配合 @lakutata/core 使用
```

TypeORM 1.1.2（MIT）的源码包含在这个包中（见 `THIRD_PARTY_NOTICES.md`），所以不会安装 `typeorm` 包；基于 `typeorm` 包的库（它的 NestJS 模块、命名策略库等）也不会使用这份副本。数据库驱动不是这个包的依赖：请按连接选项的 `type` 安装对应的驱动。

| 数据库 | `type` | 需要安装 |
|---|---|---|
| PostgreSQL、CockroachDB | `postgres`、`cockroachdb` | `pg` |
| MySQL、MariaDB | `mysql`、`mariadb` | `mysql2`（3.15.3 或更高） |
| SQLite | `better-sqlite3` | `better-sqlite3`（12） |
| WebAssembly 版的 SQLite | `sqljs` | `sql.js` |
| Microsoft SQL Server | `mssql` | `mssql`（12） |
| Oracle | `oracle` | `oracledb` |
| MongoDB | `mongodb` | `mongodb`（7） |
| 嵌入进程内的 MongoDB | `mongo-embedded` | `mingo` 和 `bson`（7） |
| SAP HANA | `sap` | `@sap/hana-client` |
| Google Cloud Spanner | `spanner` | `@google-cloud/spanner`（8） |

`sqljs` 驱动把整个数据库放在内存中。设置了 `location` 选项时，它在连接时从这个文件加载数据库；设置了 `autoSave: true` 时，每次变化后写回文件；调用它的实体管理器（`SqljsEntityManager`）的 `saveDatabase()` 时也会写回；`exportDatabase()` 以 `Uint8Array` 返回数据库。

`mongo-embedded` 是 lakutata 添加的：它让 TypeORM 对 MongoDB 的支持（带 `@ObjectIdColumn` 的实体、查询选项中的 MongoDB 操作符、`MongoRepository`）运行在进程内的数据库上。文档写入 `database` 选项所指定目录中的文件（目录不存在时会创建；默认值 `':memory:'` 把文档保存在内存中）。每次写入都以一次操作追加到文件，文档通过保存在内存中（V8 堆之外）的索引按 `_id` 查找，mingo 按 MongoDB 的语义执行查询。

`sync` 选项决定写入什么时候刷到磁盘：`'interval'`（默认）每隔 `syncInterval`（100 毫秒）刷一次，所以写入在进程崩溃后依然存在，但断电时可能丢失最后一个间隔内的写入；其他取值是 `'always'` 和 `'never'`。读过的文档会缓存在内存中（`cacheSize`，默认 64 MiB）：扫描一个文档全部已缓存的集合时，不会读取它的任何文件。写入被崩溃打断时，数据库会保持这次写入之前的样子。

压缩集合的文件时，读写照常进行（`compaction` 选项：文件达到 16 MiB 之后，一旦是有效文档大小的两倍就压缩）。集合的索引在数据库关闭时保存到快照，在使用期间也会保存（`snapshot` 选项：自上次快照以来写入了 64 MiB，并且达到文件的四分之一时）。再次打开数据库时会读取快照，所以崩溃之后只需要读取快照之后写入的记录。只有一个进程能打开这个目录，打开它的进程会把它锁住。

数据库运行在一个 worker 线程中（`worker` 选项，默认 `true`），所以它的查询、写入和文件操作都不会阻塞应用的事件循环。参数和结果以 BSON 格式在线程之间传递（每次调用大约 20 微秒）；worker 线程运行它自己的 mingo 和 bson 副本，它们已经打包进这个包。它的限制（`workerResourceLimits`，即 Node.js 的 `resourceLimits`）默认不设置，所以它沿用应用线程的限制（`--max-old-space-size`）。超出限制时，结束的是 worker 线程而不是进程：它的调用会失败，它的目录被解锁（在 Node.js 24 上，256 MB 或更小的堆可能让整个进程结束；Bun 会忽略这些限制）。`worker: false` 让数据库运行在应用的线程中，这时查询还可以使用 JavaScript 函数（`$where`、`$function`、`$accumulator`）。

耗时的写入（`insertMany`、`updateMany`、`deleteMany`，以及在已有文档上创建索引）按每批 1000 个文档执行，批与批之间让出事件循环。某个文档写入失败时，它之前的文档已经写入，不会撤销，和不使用事务的 MongoDB 一样。与 MongoDB 相同，`insertMany` 在遇到第一个重复键时停止，设置 `ordered: false` 时则继续插入其他文档；最后都以失败结束，错误中带有这些文档的 `writeErrors`、`insertedCount` 和 `insertedIds`。

位于管道开头的 `$group`（或 `$count` 阶段），如果它前面只有逐个处理文档的阶段（`$match`、`$project`、`$unwind`……），会每次处理一批文档，所以内存中只保留它的各个分组。用 `next()`、`hasNext()` 或 `for await` 读取的游标（`MongoRepository` 的 `createCursor` 和 `createEntityCursor`），在没有排序（也没有 1000 或更小的 limit）时每次读取 1000 个文档；`toArray()` 则一次读取全部。和 MongoDB 一样，游标读取期间写入的文档可能被漏掉（在游标读到之前被更新或删除，或者是新插入的），也可能被读到两次（集合正在压缩时）。有游标正在读取集合（或者正在创建集合的某个索引）时，不会开始压缩这个集合；已经在进行的压缩，要等读取它的文件的游标都结束后才完成。10 分钟没有读取的游标不再阻止压缩：压缩会关闭它，它的下一次读取会失败（在 worker 线程中，这样的游标无论如何都会在 10 分钟后关闭）。

没有索引的排序会把参与排序的所有文档放在内存中，即使后面跟着 `limit` 也是如此：请给大型集合中用于排序的字段建索引。字段有索引时，带 `limit` 的排序按索引的顺序读取；其他情况下由 mingo 在内存中排序，超过 2^53 的整数（以 `Long` 保存）排在其他数字之后，按文本顺序排列。索引键最多大约 1000 字节（键的值和 `_id` 编码在一起：`_id` 是 `ObjectId` 时，字符串最多 995 字节）。会产生更大键的写入在写入之前就会失败，错误码是 MongoDB 在 4.2 之前使用的 17280（在 `insertMany` 中，作为该文档的错误）。

和 `mongodb` 类型一样，不支持 TypeORM 的关系、查询构造器和事务（`transaction()` 会在没有事务的情况下执行它的函数），迁移需要手写（通过 `queryRunner.manager`，它是一个 `MongoEntityManager`），不能生成。`ObjectId` 和 `Binary` 值来自 `bson` 的 CommonJS 模块。`import {ObjectId} from 'lakutata/orm'` 得到的是实体 id 的类，也是 `@ObjectIdColumn()` 属性的类型。在 ES 模块中用 `import {ObjectId} from 'bson'` 得到的 `ObjectId` 是另一个类：对这些 id 做 `instanceof` 判断会得到 false，不过查询两者都接受。

存在 Redis 中的查询结果缓存（`cache: {type: 'redis'}` 或 `'ioredis'`）需要安装 `redis` 或 `ioredis` 包。

实体依赖装饰器及其元数据：应用所用的 TypeScript 选项（`"extends": "lakutata/tsconfig.json"`）开启了 `experimentalDecorators` 和 `emitDecoratorMetadata`。

## 用法

### 在应用中使用数据库

`buildDatabaseOptions` 用 TypeORM 的连接选项（`DataSourceOptions`，原样交给 TypeORM）注册一个 `Database` 组件。组件在创建时连接数据库，列在 `bootstrap` 里时，它在应用启动过程中创建；应用停止时，它会断开连接。连接失败会中止应用的启动。

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildDatabaseOptions, Database} from 'lakutata/com/database'
import {Column, CreateDateColumn, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('users')
class User {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({unique: true})
    public email: string

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date
}

class Users extends Component {
    //注册为 db 的组件
    @Inject('db')
    protected readonly db: Database

    public async register(email: string): Promise<User> {
        return await this.db.getRepository(User).save({email: email})
    }

    public async find(email: string): Promise<User | null> {
        return await this.db.getRepository(User).findOneBy({email: email})
    }
}

Application
    .run(() => ({
        id: 'com.example.users',
        name: 'Users',
        components: {
            db: buildDatabaseOptions({
                type: 'postgres',
                host: process.env.DB_HOST ?? 'localhost',
                port: 5432,
                username: 'postgres',
                password: process.env.DB_PASSWORD,
                database: 'users',
                entities: [User],
                //只用于开发：表结构跟随实体变化；生产环境中由迁移变更表结构
                synchronize: true
            }),
            users: {class: Users}
        },
        bootstrap: ['db']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const users: Users = await app.getObject('users')
        await users.register('ada@example.com')
    })
```

常用的连接选项（各驱动的选项见 TypeORM 的文档）：

| 选项 | 作用 |
|---|---|
| `type` | 驱动：`'postgres'`、`'mysql'`、`'better-sqlite3'`…… |
| `url` 或 `host`、`port`、`username`、`password`、`database` | 服务器和数据库 |
| `schema` | 表所在的 PostgreSQL schema（默认取服务器的 `search_path`，通常是 `public`） |
| `entities` | 实体类、`EntitySchema`，或者编译后文件的 glob（`'build/entities/*.js'`） |
| `synchronize` | 每次连接时按实体更新表结构（默认 `false`）：只用于开发 |
| `migrations`、`migrationsTableName`、`migrationsRun`、`migrationsTransactionMode` | 迁移、记录迁移的表（默认 `migrations`）、是否在每次连接时执行迁移（默认 `false`）、迁移的事务（默认 `'all'`） |
| `logging`、`logger` | TypeORM 记录什么（`true`、`['error', 'schema']`……），以及记录到哪里 |
| `poolSize`、`extra` | 连接池的大小；传给驱动的选项（`pg` 用 `extra: {max: 20}`） |
| `subscribers`、`namingStrategy`、`cache` | 实体订阅者、表和列的命名方式、查询结果的缓存 |

框架改变了一个选项的默认值：`invalidWhereValuesBehavior` 默认为 `{null: 'ignore', undefined: 'ignore'}`，即 TypeORM 0.3 的行为（TypeORM 1 默认抛出错误）。where 条件中值为 `null` 或 `undefined` 的属性会从条件中去掉。你给出的每个键会替换它的默认值（`invalidWhereValuesBehavior: {undefined: 'throw'}` 遇到 `undefined` 值时抛出错误）。在默认设置下，`findOneBy({id: undefined})` 会查到第一行，所以用请求中的值查询之前，要先检查它们。

如果用 TypeORM 0.3 创建的数据库中，表名或列名含有非 ASCII 字符，TypeORM 1 给它们的索引和约束起的名字会不同，生成的迁移就会重命名它们。`lakutata/orm` 中的 `NamingStrategyV03`（`namingStrategy: new NamingStrategyV03()`）可以保持 TypeORM 0.3 的命名。

### 实体

`lakutata/decorator/orm` 中的装饰器就是 TypeORM 的装饰器：`@Entity`、`@ViewEntity`，列（`@Column`、`@PrimaryColumn`、`@PrimaryGeneratedColumn`、`@CreateDateColumn`、`@UpdateDateColumn`、`@DeleteDateColumn`、`@VersionColumn`、`@VirtualColumn`、`@ViewColumn`、`@ObjectIdColumn`、`@Generated`），关系（`@OneToOne`、`@OneToMany`、`@ManyToOne`、`@ManyToMany`、`@JoinColumn`、`@JoinTable`、`@RelationId`），约束（`@Index`、`@Unique`、`@Check`、`@Exclusion`），树（`@Tree`、`@TreeParent`、`@TreeChildren`、`@TreeLevelColumn`），继承（`@TableInheritance`、`@ChildEntity`），实体监听器（`@BeforeInsert`、`@AfterLoad`……），以及 `@EventSubscriber`。

```typescript
import {
    BeforeInsert, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany,
    PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn
} from 'lakutata/decorator/orm'

@Entity('orders')
export class Order {
    @PrimaryGeneratedColumn('uuid')
    public id: string

    @Index()
    @Column()
    public customer: string

    //pg 把 numeric 列读成字符串：由 transformer 转换成数字
    @Column('numeric', {precision: 12, scale: 2, transformer: {to: (value: number): number => value, from: (value: string): number => Number(value)}})
    public total: number

    @Column('jsonb', {nullable: true})
    public metadata: Record<string, unknown> | null

    //随订单一起保存
    @OneToMany(() => OrderLine, (line: OrderLine) => line.order, {cascade: true})
    public lines: OrderLine[]

    @CreateDateColumn({type: 'timestamptz'})
    public createdAt: Date

    @UpdateDateColumn({type: 'timestamptz'})
    public updatedAt: Date

    //由 softDelete() 设置：除非设置了 withDeleted，查询会跳过这个订单
    @DeleteDateColumn({type: 'timestamptz'})
    public deletedAt: Date | null

    //每次保存加一
    @VersionColumn()
    public version: number

    @BeforeInsert()
    protected normalize(): void {
        this.customer = this.customer.trim()
    }
}

@Entity('order_lines')
export class OrderLine {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public product: string

    @Column('integer')
    public quantity: number

    @ManyToOne(() => Order, (order: Order) => order.lines, {onDelete: 'CASCADE'})
    @JoinColumn({name: 'order_id'})
    public order: Order
}
```

实体也可以继承 `BaseEntity`（来自 `lakutata/orm`），以 Active Record 的方式操作（`User.findOneBy()`、`user.save()`）；这些操作使用最后一个注册了该实体的连接。

### 查询

`lakutata/orm` 导出 TypeORM 的 API：仓储、查询操作符（`In`、`ILike`、`Between`、`MoreThan`、`IsNull`、`Not`、`Raw`、`ArrayContains`、`JsonContains`……）、查询构造器、实体管理器和错误。查询选项使用对象：`relations: {author: true}`、`select: {id: true, title: true}`（TypeORM 1 去掉了名称数组的写法）。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
import {Between, ILike, In, type Repository} from 'lakutata/orm'

@Entity('orders')
class Order {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public customer: string

    @Column()
    public status: string

    @Column('integer')
    public total: number

    @Column({type: 'timestamptz'})
    public createdAt: Date
}

class Orders extends Component {
    @Inject('db')
    protected readonly db: Database

    protected get orders(): Repository<Order> {
        return this.db.getRepository(Order)
    }

    //分页查询某段时间内的订单，同时返回总数
    public async search(customer: string, from: Date, to: Date, page: number): Promise<[Order[], number]> {
        return await this.orders.findAndCount({
            where: {customer: ILike(`%${customer}%`), status: In(['paid', 'shipped']), createdAt: Between(from, to)},
            order: {createdAt: 'DESC'},
            skip: (page - 1) * 20,
            take: 20
        })
    }

    //用查询构造器做聚合
    public async totals(): Promise<{ customer: string, total: string }[]> {
        return await this.db.createQueryBuilder(Order, 'order')
            .select('order.customer', 'customer')
            .addSelect('SUM(order.total)', 'total')
            .groupBy('order.customer')
            .getRawMany()
    }

    //原生 SQL：PostgreSQL 的占位符是 $1、$2……
    public async count(status: string): Promise<number> {
        const rows: { count: string }[] = await this.db.query('SELECT COUNT(*) AS count FROM orders WHERE status = $1', [status])
        return Number(rows[0].count)
    }
}
```

### 事务

`transaction()` 在事务中执行一个函数：函数成功（resolve）时提交，失败（reject）时回滚，并重新抛出错误。事务中的操作要通过传给函数的实体管理器执行；通过 `db.manager` 或 `db.getRepository()` 执行的操作不在事务中。用查询运行器（query runner）可以手动控制事务。

```typescript
import {Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'
import {type EntityManager, type QueryRunner} from 'lakutata/orm'

@Entity('accounts')
class Account {
    @PrimaryGeneratedColumn()
    public id: number

    @Column('integer', {default: 0})
    public balance: number
}

class Bank extends Component {
    @Inject('db')
    protected readonly db: Database

    //两个更新要么都完成，要么都不完成
    public async transfer(from: number, to: number, amount: number): Promise<void> {
        await this.db.transaction('SERIALIZABLE', async (manager: EntityManager): Promise<void> => {
            const source: Account = await manager.findOneByOrFail(Account, {id: from})
            if (source.balance < amount) throw new Error('Insufficient balance')
            await manager.decrement(Account, {id: from}, 'balance', amount)
            await manager.increment(Account, {id: to}, 'balance', amount)
        })
    }

    //同样的事务，手动控制
    public async deposit(id: number, amount: number): Promise<void> {
        const runner: QueryRunner = this.db.createQueryRunner()
        await runner.connect()
        await runner.startTransaction()
        try {
            await runner.manager.increment(Account, {id: id}, 'balance', amount)
            await runner.commitTransaction()
        } catch (error) {
            await runner.rollbackTransaction()
            throw error
        } finally {
            //连接回到连接池
            await runner.release()
        }
    }
}
```

### Database 提供者

`lakutata/provider/database` 中的提供者与组件的 API 相同，但它的生命周期是 `@Transient`：每次解析（`@Inject`、`getObject()`）都会创建一个新实例，打开自己的连接池；实例随创建它的对象或容器一起销毁时，连接池也会关闭。它适合短时的任务（一个作业、一个脚本、一个租户的数据库），而应用处理请求时共用组件。它的 `entities` 选项会加到连接选项的实体中。

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions, Database} from 'lakutata/provider/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('reports')
class Report {
    @PrimaryGeneratedColumn()
    public id: number

    @Column('text')
    public content: string
}

Application
    .run(() => ({
        id: 'com.example.reports',
        name: 'Reports',
        providers: {
            reports: {
                ...buildDatabaseOptions({type: 'postgres', url: process.env.REPORTS_URL}),
                entities: [Report]
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        //在这里打开连接，随应用一起关闭
        const database: Database = await app.getObject('reports')
        console.log(await database.getRepository(Report).count())
    })
```

### 多个数据库

每个数据库都是一个有自己名字的组件，按这个名字注入。迁移命令作用于所有数据库，或者 `MIGRATION_DATABASE` 指定的那一个。

```text
components: {
    db: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: [User, Order]}),
    analytics: buildDatabaseOptions({type: 'postgres', url: process.env.ANALYTICS_URL, entities: [Event]})
}
```

### 迁移

迁移是实现了 `MigrationInterface` 的类：`up()` 变更表结构，`down()` 撤销这个变更。连接选项 `migrations` 列出迁移（迁移类，或者编译后文件的 glob），`migrations` 表记录已经执行的迁移。

```typescript
import {type MigrationInterface, type QueryRunner} from 'lakutata/orm'

export class Migrations1760000000000 implements MigrationInterface {
    public name: string = 'Migrations1760000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" ADD "name" character varying')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "users" DROP COLUMN "name"')
    }
}
```

迁移可以在数据库连接时执行（设置 `migrationsRun: true`），可以通过 `Database` 组件或提供者的 `runMigrations()` 和 `undoLastMigration()` 执行，也可以通过应用的命令执行。

这些命令是由应用自己读取的环境变量；`lakutata migration`（来自 `@lakutata/cli`）会带着它们启动应用。带着其中某个变量启动时，应用读取自己的选项，然后不执行 `bootstrap` 和 `onLaunched` 回调，而是对选项中的每个 `Database` 组件和提供者执行命令，最后退出。每个数据库连接时，`synchronize`、`migrationsRun` 和 `dropSchema` 都被强制设为 `false`。变量名不区分大小写，开关变量的值为 `1`、`true` 或 `yes` 时生效。

| 变量 | 命令 |
|---|---|
| `MIGRATION_GENERATE=<directory>` | 比较实体与数据库的表结构，把差异的 SQL 写成一个迁移：`<directory>/<timestamp>-<database name>.ts`（目录相对于工作目录，需要时会创建），类名为 `<Directory><timestamp>`（`src/migrations` 得到 `Migrations1760000000000`）；项目依赖 `@lakutata/orm` 时，迁移从它导入类型，否则从 `lakutata/orm` 导入 |
| `MIGRATION_RUN=1` | 执行待执行的迁移，执行时逐个输出 |
| `MIGRATION_REVERT=1` | 撤销最后执行的迁移（应用有多个数据库时需要 `MIGRATION_DATABASE`） |
| `MIGRATION_SHOW=1` | 输出每个迁移，已执行的标为 `[X]`，待执行的标为 `[ ]`，并输出待执行的数量 |
| `MIGRATION_DATABASE=<name>` | 命令针对的数据库：它的组件或提供者的名字（默认所有数据库） |
| `MIGRATION_TRANSACTION=all\|each\|none` | `MIGRATION_RUN` 和 `MIGRATION_REVERT` 使用的事务（默认取数据库的 `migrationsTransactionMode` 选项，没有时为 `all`） |
| `MIGRATION_FAKE=1` | 只把迁移记录为已执行（或已撤销），不真正执行 |

同时设置了多个变量时，只执行一个命令，优先级依次是 `MIGRATION_GENERATE`、`MIGRATION_RUN`、`MIGRATION_REVERT` 和 `MIGRATION_SHOW`。

```shell
# 用编译后的应用生成迁移（数据库必须能连上，并且已经执行了已有的迁移）
MIGRATION_GENERATE=src/migrations node build/App.js
# 编译这个迁移，然后
MIGRATION_SHOW=1 node build/App.js
MIGRATION_RUN=1 node build/App.js
MIGRATION_REVERT=1 MIGRATION_DATABASE=db node build/App.js
```

生成的文件遵循 TypeORM 的代码风格（双引号、分号）：请格式化它，或者让 linter 跳过迁移文件。命令完成后，进程以退出码 0 退出；失败时以退出码 1 退出，失败的情况包括：无效的 `MIGRATION_TRANSACTION`、未知的 `MIGRATION_DATABASE`、没有数据库（`MIGRATION_GENERATE` 除外，这时以 0 退出）、有多个数据库时使用 `MIGRATION_REVERT` 却没有指定 `MIGRATION_DATABASE`、数据库连接不上、迁移失败（之后的数据库会被跳过），或者 `MIGRATION_GENERATE` 在所有数据库中都没有发现变化。

数据库的实体就是它连接选项中的实体；对于 `Database` 提供者，还要加上它 `entities` 选项中的实体。

## API

| 导出 | 子路径 | 说明 |
|---|---|---|
| `Database`、`buildDatabaseOptions` | `lakutata/com/database` | 数据库组件（共享的连接）及其注册函数 |
| `Database`、`buildDatabaseOptions` | `lakutata/provider/database` | 数据库提供者（每次解析一个连接）及其注册函数 |
| `MigrationRunOptions` | `lakutata/com/database`、`lakutata/provider/database` | `runMigrations()` 和 `undoLastMigration()` 的选项 |
| `Entity`、`Column`、`PrimaryGeneratedColumn`、`OneToMany`、`ManyToOne`、`Index`、`BeforeInsert`…… | `lakutata/decorator/orm` | TypeORM 的装饰器 |
| `Repository`、`EntityManager`、`QueryRunner`、`SelectQueryBuilder`、`DataSource`、`BaseEntity`…… | `lakutata/orm` | TypeORM 的类和类型 |
| `In`、`ILike`、`Between`、`MoreThan`、`IsNull`、`Not`、`Raw`…… | `lakutata/orm` | TypeORM 的查询操作符 |
| `MigrationInterface`、`Migration`、`MigrationExecutor` | `lakutata/orm` | 迁移 |
| `DataSourceOptions`、`PostgresDataSourceOptions`、`MysqlDataSourceOptions`…… | `lakutata/orm` | 各驱动的连接选项（它们在 TypeORM 0.3 中的名字 `PostgresConnectionOptions` 等已弃用） |
| `QueryFailedError`、`EntityNotFoundError`、`TypeORMError`…… | `lakutata/orm` | TypeORM 的错误 |

lakutata 的声明在类型声明中附有说明和示例；TypeORM 的声明见 [TypeORM](https://typeorm.io) 的文档。

## 错误

这个包抛出驱动的错误和 TypeORM 的错误，后者由 `lakutata/orm` 导出：

| 错误 | 什么时候抛出 |
|---|---|
| 驱动的错误（`pg` 的 `DatabaseError`、`ECONNREFUSED`……） | `Database` 组件或提供者无法连接：它的创建会失败（reject），组件列在 `bootstrap` 中时，应用启动失败 |
| `QueryFailedError` | 数据库拒绝了查询（违反约束、语法错误）；它的 `driverError` 是驱动的错误（PostgreSQL 违反唯一约束时 `code` 为 `23505`） |
| `EntityNotFoundError` | `findOneOrFail()`、`findOneByOrFail()` 没有找到实体 |
| `EntityMetadataNotFoundError` | 实体不在连接的 `entities` 中 |
| `OptimisticLockVersionMismatchError` | 使用 `lock: {mode: 'optimistic', version}` 查询时，读到了另一个版本 |
| `CannotExecuteNotConnectedError` | 在已关闭的连接上执行 `synchronize()` 或迁移 |
| `TypeORMError` | TypeORM 错误的基类，本身也会被抛出（在其他数据库上调用了 MongoDB 的方法、找不到关系……） |

## 另见

- `lakutata` 包中的指南（`doc/zh`）：`Database.md`、`DatabaseDrivers.md`、`MongoEmbedded.md`、`Entities.md`、`Migrations.md`。
- TypeORM 的文档：[typeorm.io](https://typeorm.io)（实体、关系、查询选项、查询构造器、迁移）。
- `@lakutata/core`：应用、组件和提供者、依赖注入。
