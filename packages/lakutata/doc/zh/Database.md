# Lakutata 数据库

lakutata 的数据库层是 `@lakutata/orm` 包，基于 [TypeORM](https://typeorm.io) 1 构建。TypeORM 的源码已经包含在这个包里，所以不会再安装 `typeorm` 包。`lakutata` 通过四个子路径重新导出它：

| 子路径 | 提供的内容 |
|---|---|
| `lakutata/com/database` | `Database` 组件（整个应用共享的连接）和 `buildDatabaseOptions` |
| `lakutata/provider/database` | `Database` 提供者（每次解析都有自己的连接） |
| `lakutata/decorator/orm` | 实体的装饰器（`@Entity`、`@Column`、各种关系……） |
| `lakutata/orm` | TypeORM 的 API：仓储、实体管理器、查询操作符、迁移、错误 |

数据库驱动需要另外安装，见 [DatabaseDrivers](DatabaseDrivers.md)。实体、查询和事务见 [Entities](Entities.md)，表结构的变更见 [Migrations](Migrations.md)。

## 1. Database 组件

`buildDatabaseOptions` 用 TypeORM 的连接选项声明一个 `Database` 组件：

```typescript
import {Application, Component} from 'lakutata'
import {Inject} from 'lakutata/decorator/di'
import {buildDatabaseOptions, Database} from 'lakutata/com/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('users')
class User {
    @PrimaryGeneratedColumn()
    public id: number

    @Column({type: 'varchar', length: 100})
    public name: string

    @Column({unique: true})
    public email: string
}

class Users extends Component {
    //声明为 "db" 的组件
    @Inject('db')
    protected readonly db: Database

    public async register(name: string, email: string): Promise<User> {
        return await this.db.getRepository(User).save({name: name, email: email})
    }

    public async find(id: number): Promise<User | null> {
        return await this.db.getRepository(User).findOneBy({id: id})
    }
}

Application
    .run(() => ({
        id: 'users.app',
        name: 'Users',
        components: {
            db: buildDatabaseOptions({
                type: 'postgres',
                url: process.env.DATABASE_URL,
                entities: [User],
                //只用于开发：表结构跟随实体变化。生产环境请使用迁移
                synchronize: true
            }),
            users: {class: Users}
        },
        bootstrap: ['db']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const users: Users = await app.getObject<Users>('users')
        await users.register('Ada', 'ada@example.com')
    })
```

- 组件在创建时连接数据库。列在 `bootstrap` 里时，它在应用启动过程中连接，连接失败会让启动失败；否则在第一次被用到时才连接。
- 应用停止时，它会断开连接。
- 其他对象按名字注入它（`@Inject('db')`），或者用 `getObject('db')` 获取。

## 2. 连接选项

这些选项就是 TypeORM 的选项，会原样交给 TypeORM。各驱动特有的选项见 [DatabaseDrivers](DatabaseDrivers.md)，通用的选项有：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `type` | 必填 | 驱动：`'postgres'`、`'mysql'`、`'better-sqlite3'`…… |
| `entities` | | 实体类、`EntitySchema`，或者编译后文件的 glob（`'build/entities/*.js'`） |
| `synchronize` | `false` | 每次连接时按实体更新表结构。只用于开发 |
| `logging` | `false` | TypeORM 记录什么：`true`，或者 `'query'`、`'error'`、`'schema'`、`'warn'`、`'info'`、`'log'` 组成的列表 |
| `logger` | | TypeORM 的日志写到哪里：`'advanced-console'`、`'simple-console'`、`'file'`、`'debug'`，或者自己实现的日志记录器 |
| `maxQueryExecutionTime` | | 记录比这个时间（毫秒）慢的查询 |
| `poolSize` | | 连接池的连接数 |
| `extra` | | 传给驱动客户端的选项 |
| `migrations`、`migrationsRun`、`migrationsTableName`、`migrationsTransactionMode` | | 迁移（见 [Migrations](Migrations.md)） |
| `subscribers` | | 实体订阅者 |
| `namingStrategy` | | 表、列和索引的命名方式 |
| `cache` | | 查询结果的缓存：`true`（存在数据库的一张表里），或者 `{type: 'redis', options}` |
| `invalidWhereValuesBehavior` | `{null: 'ignore', undefined: 'ignore'}` | where 条件中的 `null` 和 `undefined` 如何处理（见下文） |

**条件中的 `null` 和 `undefined`。** 默认情况下，where 条件中值为 `null` 或 `undefined` 的属性会被忽略，这与 TypeORM 0.3 相同；TypeORM 1 的默认行为则是抛出错误。所以 `findOneBy({id: undefined})` 会查到表里的第一行：用请求中的值查询之前要先检查它们，或者设置 `invalidWhereValuesBehavior: {undefined: 'throw'}`，让这类值抛出错误（给出的每个键会替换它的默认值）。

**用 TypeORM 0.3 创建的数据库。** 如果表名或列名中有非 ASCII 字符，TypeORM 1 给它们的索引和约束起的名字会不同，生成的迁移就会重命名它们。`namingStrategy: new NamingStrategyV03()`（来自 `lakutata/orm`）可以保持 TypeORM 0.3 的命名。

**存在 Redis 中的查询缓存**（`cache: {type: 'redis'}` 或 `'ioredis'`）需要安装 `redis` 或 `ioredis` 包。

## 3. 组件提供的功能

组件提供 TypeORM 数据源的 API：

| 方法或属性 | 作用 |
|---|---|
| `getRepository(Entity)` | 实体的仓储（在 MongoDB 上是 `MongoRepository`） |
| `getMongoRepository(Entity)`、`getTreeRepository(Entity)` | MongoDB 的仓储、树形实体的仓储 |
| `manager` | 实体管理器 |
| `transaction(fn)`、`transaction(isolationLevel, fn)` | 在事务中执行一个函数 |
| `query(sql, parameters)` | 执行 SQL；占位符在 PostgreSQL 上是 `$1, $2…`，在 MySQL 和 SQLite 上是 `?` |
| `createQueryBuilder(Entity, alias)` | 查询构造器 |
| `createQueryRunner(mode)` | 连接池中的一个连接，用来手动控制事务；`'slave'` 从副本读取 |
| `synchronize()` | 按实体更新表结构 |
| `runMigrations()`、`undoLastMigration()`、`showMigrations()` | 执行、回退和列出迁移 |
| `hasMetadata(Entity)`、`getMetadata(Entity)` | 是否认识某个实体，以及它的元数据 |

## 4. Database 提供者

`lakutata/provider/database` 中的 `Database` 有同样的 API，但它是**瞬态**的：每次解析（`@Inject`、`getObject()`）都会创建一个新实例，打开自己的连接池；它随创建它的对象或容器一起销毁时，连接池也会关闭。它适合短时的任务（一个作业、一个脚本、每个客户一个数据库），而应用中的请求共享组件。

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions, Database} from 'lakutata/provider/database'
import {Column, Entity, PrimaryGeneratedColumn} from 'lakutata/decorator/orm'

@Entity('reports')
class Report {
    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public title: string
}

Application
    .run(() => ({
        id: 'reports.app',
        name: 'Reports',
        providers: {
            reports: {
                ...buildDatabaseOptions({type: 'postgres', url: process.env.REPORTS_URL}),
                //加到连接选项的实体中
                entities: [Report]
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        //在这里打开连接，随应用一起关闭
        const database: Database = await app.getObject<Database>('reports')
        console.log(await database.getRepository(Report).count())
    })
```

## 5. 多个数据库

每个数据库都是一个独立的组件，按各自的名字注入：

```typescript
import {Application} from 'lakutata'
import {buildDatabaseOptions} from 'lakutata/com/database'

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        db: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: []}),
        analytics: buildDatabaseOptions({type: 'mysql', url: process.env.ANALYTICS_URL, entities: []})
    },
    bootstrap: ['db', 'analytics']
}))
```

一个实体可以属于多个数据库。它的仓储来自调用 `getRepository()` 的那个数据库。
